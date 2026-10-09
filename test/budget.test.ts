import { describe, expect, it } from "vitest";
import { analyzeFlight } from "../src/core/analyze.js";
import { budgetFor, checkBudgets, matchRoute, validateConfig, type RouteResult } from "../src/core/budget.js";
import { formatBytes, parseBytes } from "../src/core/units.js";

describe("matchRoute", () => {
  it.each([
    ["/", "/", true],
    ["/blog/*", "/blog/hello", true],
    ["/blog/*", "/blog", false],
    ["/blog/*", "/blog/2026/hello", false],
    ["/blog/**", "/blog", true],
    ["/blog/**", "/blog/2026/hello", true],
    ["/**", "/anything/at/all", true],
    ["/products", "/products-lean", false],
  ])("%s matches %s: %s", (pattern, route, expected) => {
    expect(matchRoute(pattern, route)).toBe(expected);
  });
});

describe("sizes", () => {
  it.each([
    ["128kB", 128_000],
    ["128 kB", 128_000],
    ["1.5MB", 1_500_000],
    ["64KiB", 65_536],
    ["900", 900],
  ])("parses %s", (input, bytes) => {
    expect(parseBytes(input)).toBe(bytes);
  });

  it("rejects nonsense", () => {
    expect(() => parseBytes("big")).toThrow(/as a size/);
  });

  it("formats like DevTools", () => {
    expect([999, 128_000, 132_740, 1_500_000].map(formatBytes)).toEqual(["999 B", "128 kB", "132.7 kB", "1.5 MB"]);
  });
});

describe("checkBudgets", () => {
  const result = (route: string, bytes: number): RouteResult => ({
    route,
    report: { ...analyzeFlight(`0:null\n`), payloadBytes: bytes },
    gzip: { payload: bytes / 10 },
  });

  it("applies a 128 kB payload budget by default", () => {
    expect(checkBudgets([result("/a", 127_000), result("/b", 129_000)])).toEqual([
      { route: "/b", metric: "payload", actual: 129_000, limit: 128_000 },
    ]);
  });

  it("uses the first matching route budget, then the default", () => {
    const config = { budgets: [{ route: "/blog/**", payload: "200kB" }], defaultBudget: { payload: "50kB" } };
    expect(budgetFor("/blog/post", config)).toMatchObject({ payload: "200kB" });
    expect(checkBudgets([result("/blog/post", 150_000), result("/", 60_000)], config).map((v) => v.route)).toEqual(["/"]);
  });

  it("checks gzip budgets", () => {
    const violations = checkBudgets([result("/", 100_000)], { defaultBudget: { payloadGzip: "5kB" } });
    expect(violations).toEqual([{ route: "/", metric: "payloadGzip", actual: 10_000, limit: 5_000 }]);
  });

  it("can turn the default budget off", () => {
    expect(checkBudgets([result("/", 1_000_000)], { defaultBudget: false })).toEqual([]);
  });
});

describe("validateConfig", () => {
  it("names the bad key", () => {
    expect(() => validateConfig({ budgets: [{ route: "/", flight: "10kB" }] })).toThrow(/unknown budget "flight"/);
  });

  it("requires a route on each budget", () => {
    expect(() => validateConfig({ budgets: [{ payload: "10kB" }] })).toThrow(/needs a "route"/);
  });
});
