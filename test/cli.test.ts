import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/node/main.js";
import { routeFromFile } from "../src/node/sources.js";

const project = path.join(import.meta.dirname, "fixtures/next-shop");
const app = path.join(project, ".next/server/app");

let output: string[];
beforeEach(() => {
  output = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void output.push(line));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("rscope", () => {
  it("analyzes every prerendered route in a build and fails the one over budget", async () => {
    expect(await main([project, "--no-color"])).toBe(1);
    const text = output.join("\n");
    expect(text).toMatch(/✖\s+\/products\s+132\.7 kB/);
    expect(text).toMatch(/✓\s+\/products-lean/);
    expect(text).not.toContain("_not-found");
    expect(text).toContain("/products is over budget: payload 132.7 kB > 128 kB");
  });

  it("passes with a bigger budget", async () => {
    expect(await main([project, "--no-color", "--budget", "200kB"])).toBe(0);
  });

  it("shows the breakdown, with source files, for a single route", async () => {
    await main([path.join(app, "products.html"), "--no-color"]);
    const text = output.join("\n");
    expect(text).toContain("Client components by props size");
    expect(text).toMatch(/ProductCard\s+126\.9 kB\s+×48/);
    expect(text).toMatch(/\.reviews\s+59\.5 kB/);
    expect(text).toContain("240×");
  });

  it("names source files when reading a build", async () => {
    await main([project, "--no-color", "--detail"]);
    expect(output.join("\n")).toContain("components/product-card.tsx");
  });

  it("prints JSON", async () => {
    await main([project, "--json", "--budget", "1MB"]);
    const json = JSON.parse(output.join("\n"));
    expect(json.routes.map((r: { route: string }) => r.route)).toEqual(["/", "/products", "/products-lean"]);
    expect(json.violations).toEqual([]);
  });

  it("reads budgets and ignores from a config file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rscope-"));
    const config = path.join(dir, "rscope.config.json");
    writeFileSync(config, JSON.stringify({ budgets: [{ route: "/products-lean", payload: "5kB" }], ignore: ["/products"] }));
    expect(await main([project, "--json", "--config", config])).toBe(1);
    const json = JSON.parse(output.join("\n"));
    expect(json.routes.map((r: { route: string }) => r.route)).toEqual(["/", "/products-lean"]);
    expect(json.violations).toMatchObject([{ route: "/products-lean", metric: "payload" }]);
  });

  it("appends a Markdown summary", async () => {
    const summary = path.join(mkdtempSync(path.join(tmpdir(), "rscope-")), "summary.md");
    await main([project, "--no-color", "--summary", summary]);
    const markdown = readFileSync(summary, "utf8");
    expect(markdown).toContain("❌ 1 of 3 routes over budget.");
    expect(markdown).toContain("| `ProductCard` | 48 | 126.9 kB |");
  });

  it("explains a missing build", async () => {
    await expect(main([path.join(tmpdir(), "nope-rscope")])).rejects.toThrow(/doesn't exist/);
    await expect(main([tmpdir()])).rejects.toThrow(/next build/);
  });
});

describe("routeFromFile", () => {
  it.each([
    ["index.html", "/"],
    ["products.html", "/products"],
    [path.join("blog", "hello.rsc"), "/blog/hello"],
    [path.join("docs", "index.html"), "/docs"],
  ])("%s → %s", (file, route) => {
    expect(routeFromFile(file)).toBe(route);
  });
});
