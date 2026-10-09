import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeDocument, analyzeFlight, BUCKETS, NoPayloadError, referencedRow, type Report } from "../src/core/analyze.js";

const app = path.join(import.meta.dirname, "fixtures/next-shop/.next/server/app");
const fixture = (name: string) => readFileSync(path.join(app, name));

const total = (report: Report) => BUCKETS.reduce((sum, b) => sum + report.breakdown[b], 0);

describe("referencedRow", () => {
  it.each([
    ["$1", "1"],
    ["$3c", "3c"],
    ["$La", "a"],
    ["$@9", "9"],
    ["$Q6", "6"],
    ["$5:props:children", "5"],
    ["$Sreact.fragment", undefined],
    ["$undefined", undefined],
    ["$D2026-01-01T00:00:00.000Z", undefined],
    ["$$escaped", undefined],
    ["plain", undefined],
  ])("%s → %s", (value, expected) => {
    expect(referencedRow(value)).toBe(expected);
  });
});

describe("analyzeFlight", () => {
  const payload = [
    `1:I["123",[],"Card"]`,
    `2:T6,héllo3:{"title":"$2","price":10}`,
    `0:["$","main",null,{"children":[["$","$L1","a",{"item":"$3","label":"x","children":["$","b",null,{"children":"bold"}]}]]}]`,
    `:HL["/a.css","style"]`,
    "",
  ].join("\n");

  it("credits every byte to exactly one bucket", () => {
    const report = analyzeFlight(payload);
    expect(total(report)).toBe(report.payloadBytes);
    expect(report.breakdown.hints).toBe(`:HL["/a.css","style"]\n`.length);
  });

  it("credits outlined rows, including text rows, to the prop that references them", () => {
    const report = analyzeFlight(payload);
    const card = report.components.find((c) => c.name === "Card")!;
    const textRow = 2 + 1 + 2 + 6; // `2:` `T` `6,` + 6 bytes
    const dataRow = `3:{"title":"$2","price":10}\n`.length;
    // `"item":` + `"$3"` + the rows it points at, then `"label":"x"`
    expect(card.propsBytes).toBe(7 + 4 + dataRow + textRow + 11);
    expect(card.paths.find((p) => p.path === "item.title")!.bytes).toBe(4 + textRow);
    expect(card.instances).toBe(1);
  });

  it("does not count children as props", () => {
    const report = analyzeFlight(payload);
    const card = report.components.find((c) => c.name === "Card")!;
    expect(card.paths.map((p) => p.path)).not.toContain("children");
  });

  it("reads React 18 module rows", () => {
    const report = analyzeFlight(`1:I{"id":"9","chunks":[],"name":"Old","async":false}\n0:["$","$L1",null,{"a":1}]\n`);
    expect(report.components[0]).toMatchObject({ name: "Old", moduleId: "9", propsBytes: 5 });
  });

  it("names default exports from the module map, and flags Next.js internals", () => {
    const report = analyzeFlight(
      `1:I["5",[],"default"]\n2:I["6",[],"default"]\n0:[["$","$L1",null,{"a":1}],["$","$L2",null,{"parallelRouterKey":"children"}]]\n`,
      { modules: new Map([["5", "app/gallery.tsx"]]) },
    );
    expect(report.components.map((c) => [c.name, c.framework, c.source])).toEqual([
      ["LayoutRouter", true, undefined],
      ["gallery", false, "app/gallery.tsx"],
    ]);
  });

  it("finds strings repeated across instances", () => {
    const body = "x".repeat(100);
    const items = Array.from({ length: 3 }, () => `["$","$L1",null,{"body":"${body}"}]`).join(",");
    const report = analyzeFlight(`1:I["1",[],"Item"]\n0:[${items}]\n`);
    expect(report.repeatedStrings).toEqual([{ preview: `${"x".repeat(79)}…`, bytes: 102, count: 3, wastedBytes: 204 }]);
  });

  it("counts streamed rows that share an id", () => {
    const report = analyzeFlight(`0:"$@7"\n7:X\n7:{"value":1}\n7:C\n`);
    expect(total(report)).toBe(report.payloadBytes);
  });
});

describe("a real Next.js 16 build", () => {
  const products = analyzeDocument(fixture("products.html").toString("utf8"));
  const lean = analyzeDocument(fixture("products-lean.html").toString("utf8"));

  it("credits every byte", () => {
    expect(total(products)).toBe(products.payloadBytes);
    expect(total(lean)).toBe(lean.payloadBytes);
  });

  it("finds the payload inlined in the document is the same as the .rsc file", () => {
    const fromRsc = analyzeFlight(fixture("products.rsc"));
    expect(fromRsc.payloadBytes).toBe(products.payloadBytes);
    expect(fromRsc.breakdown).toEqual(products.breakdown);
  });

  it("blames the component that receives whole CMS records", () => {
    const [card] = products.components;
    expect(card).toMatchObject({ name: "ProductCard", instances: 48, framework: false });
    expect(card.propsBytes / products.payloadBytes).toBeGreaterThan(0.9);
    expect(card.paths.slice(0, 3).map((p) => p.path)).toEqual(["product", "product.reviews", "product.reviews[].body"]);
    expect(products.findings.map((f) => f.rule)).toEqual(["heavy-props", "repeated-strings", "large-payload", "inline-share"]);
  });

  it("shows the lean version is an order of magnitude smaller", () => {
    expect(products.payloadBytes / lean.payloadBytes).toBeGreaterThan(10);
    expect(lean.findings.filter((f) => f.severity === "warning")).toEqual([]);
  });

  it("explains why a Pages Router document has no payload", () => {
    expect(() => analyzeDocument(`<script id="__NEXT_DATA__" type="application/json">{}</script>`)).toThrow(
      new NoPayloadError("pages-router"),
    );
  });
});
