import { describe, expect, it } from "vitest";
import { FlightParseError, parseFlight, utf8Length } from "../src/core/flight.js";

describe("parseFlight", () => {
  it("reads model, import and hint rows", () => {
    const payload = parseFlight(
      [`1:I[123,["/c.js"],"Card"]`, `:HL["/a.css","style"]`, `0:["$","div",null,{"children":"hi"}]`, ""].join("\n"),
    );
    expect(payload.rows.map((r) => [r.id, r.kind, r.tag])).toEqual([
      ["1", "import", "I"],
      ["", "hint", "H"],
      ["0", "model", ""],
    ]);
    expect(payload.byId.get("1")?.value).toEqual([123, ["/c.js"], "Card"]);
    expect(payload.rows[1].value).toEqual(["/a.css", "style"]);
  });

  it("reads text rows by byte length, not character length", () => {
    // "héllo" is 5 characters but 6 bytes; a T row has no newline, the next row follows straight on.
    const payload = parseFlight(`2:T6,héllo3:{"title":"$2"}\n`);
    expect(payload.byId.get("2")?.text).toBe("héllo");
    expect(payload.byId.get("3")?.value).toEqual({ title: "$2" });
    expect(payload.rows.reduce((sum, r) => sum + r.bytes, 0)).toBe(payload.bytes);
  });

  it("accounts for every byte, including a final row without a newline", () => {
    const text = `1:"a"\n2:{"b":[1,2]}`;
    const payload = parseFlight(text);
    expect(payload.rows.reduce((sum, r) => sum + r.bytes, 0)).toBe(utf8Length(text));
  });

  it("keeps rows that share an id, as streamed values do", () => {
    const payload = parseFlight(`7:X\n7:{"value":1}\n7:C\n`);
    expect(payload.rows.map((r) => r.tag)).toEqual(["X", "", "C"]);
    expect(payload.byId.get("7")?.tag).toBe("X");
  });

  it("classifies debug, error and binary rows", () => {
    const payload = parseFlight(`1:D{"name":"Page"}\n2:E{"digest":"x"}\n3:o2,ab4:"next"\n`);
    expect(payload.rows.map((r) => r.kind)).toEqual(["debug", "error", "binary", "model"]);
  });

  it("throws a positioned error on input that isn't a payload", () => {
    expect(() => parseFlight("<!doctype html>")).toThrow(FlightParseError);
  });
});

describe("utf8Length", () => {
  it("counts multi-byte characters and surrogate pairs", () => {
    for (const text of ["abc", "é", "°C", "日本", "👋🏽", "a\u2028b"]) {
      expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length);
    }
  });
});
