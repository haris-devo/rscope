import { describe, expect, it } from "vitest";
import { extractFlight } from "../src/core/extract.js";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("extractFlight", () => {
  it("joins the payload chunks pushed by inline scripts", () => {
    const html = [
      "<html><body><p>Hi</p>",
      "<script>(self.__next_f=self.__next_f||[]).push([0])</script>",
      `<script>self.__next_f.push([1,"0:[\\"$\\",\\"p\\",null,"])</script>`,
      `<script>self.__next_f.push([1,"{\\"children\\":\\"Hi\\"}]\\n"])</script>`,
      "</body></html>",
    ].join("");
    const extracted = extractFlight(html)!;
    expect(decode(extracted.flight)).toBe(`0:["$","p",null,{"children":"Hi"}]\n`);
    expect(extracted.scripts).toBe(3);
    expect(extracted.inlineBytes).toBeGreaterThan(extracted.flight.length);
  });

  it("decodes binary chunks", () => {
    const html = `<script>self.__next_f.push([1,"1:\\"a\\"\\n"])</script><script>self.__next_f.push([3,"${btoa('2:"b"\n')}"])</script>`;
    expect(decode(extractFlight(html)!.flight)).toBe(`1:"a"\n2:"b"\n`);
  });

  it("handles script tags with a nonce", () => {
    const html = `<script nonce="abc">self.__next_f.push([1,"0:null\\n"])</script>`;
    expect(decode(extractFlight(html)!.flight)).toBe("0:null\n");
  });

  it("returns undefined for a document without a payload", () => {
    expect(extractFlight(`<script id="__NEXT_DATA__" type="application/json">{}</script>`)).toBeUndefined();
  });
});
