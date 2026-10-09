import type { Report } from "./analyze.js";
import { LARGE_PAYLOAD_BYTES } from "./findings.js";
import { parseBytes } from "./units.js";

export type Size = string | number;

export interface Budget {
  /** RSC payload, raw bytes. Raw size drives parse time and memory; gzip drives transfer. */
  payload?: Size;
  /** RSC payload, gzipped. */
  payloadGzip?: Size;
  /** Whole HTML document, raw bytes. */
  document?: Size;
  /** Props passed to your client components, summed over the route. */
  clientProps?: Size;
}

export interface Config {
  /** Per-route budgets. The first entry whose pattern matches a route applies. */
  budgets?: (Budget & { route: string })[];
  /** Budget for routes no entry matches. Defaults to a 128 kB payload; `false` turns it off. */
  defaultBudget?: Budget | false;
  /** Route patterns to skip entirely. */
  ignore?: string[];
}

export type Metric = keyof Budget;

export const METRICS: Record<Metric, string> = {
  payload: "payload",
  payloadGzip: "payload (gzip)",
  document: "document",
  clientProps: "client props",
};

export const DEFAULT_BUDGET: Budget = { payload: LARGE_PAYLOAD_BYTES };

export interface RouteResult {
  /** Route path such as `/products`, or a file name or URL when there is no route. */
  route: string;
  report: Report;
  gzip?: { payload: number; document?: number };
}

export interface Violation {
  route: string;
  metric: Metric;
  actual: number;
  limit: number;
}

/**
 * Matches a route against a pattern: `*` is one path segment, `**` is any number of segments.
 * `/blog/*` matches `/blog/hello`; `/blog/**` also matches `/blog` and `/blog/2026/hello`.
 */
export function matchRoute(pattern: string, route: string): boolean {
  const split = (path: string) => path.split("/").filter(Boolean);
  const want = split(pattern);
  const have = split(route);

  const match = (w: number, h: number): boolean => {
    if (w === want.length) return h === have.length;
    if (want[w] === "**") return match(w + 1, h) || (h < have.length && match(w, h + 1));
    if (h === have.length) return false;
    return (want[w] === "*" || want[w] === have[h]) && match(w + 1, h + 1);
  };
  return match(0, 0);
}

export function isIgnored(route: string, config: Config): boolean {
  return (config.ignore ?? []).some((pattern) => matchRoute(pattern, route));
}

export function budgetFor(route: string, config: Config): Budget | undefined {
  const entry = config.budgets?.find((b) => matchRoute(b.route, route));
  if (entry) return entry;
  if (config.defaultBudget === false) return undefined;
  return config.defaultBudget ?? DEFAULT_BUDGET;
}

function measure(result: RouteResult, metric: Metric): number | undefined {
  switch (metric) {
    case "payload":
      return result.report.payloadBytes;
    case "payloadGzip":
      return result.gzip?.payload;
    case "document":
      return result.report.documentBytes;
    case "clientProps":
      return result.report.breakdown.clientProps;
  }
}

export function checkBudgets(results: RouteResult[], config: Config = {}): Violation[] {
  const violations: Violation[] = [];
  for (const result of results) {
    const budget = budgetFor(result.route, config);
    if (!budget) continue;
    for (const metric of Object.keys(METRICS) as Metric[]) {
      const limit = budget[metric];
      if (limit === undefined) continue;
      const actual = measure(result, metric);
      if (actual === undefined) continue;
      const bytes = parseBytes(limit);
      if (actual > bytes) violations.push({ route: result.route, metric, actual, limit: bytes });
    }
  }
  return violations;
}

/** Throws a readable error for a config that won't work, before any analysis runs. */
export function validateConfig(config: unknown): Config {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Config must be a JSON object.");
  const { budgets, defaultBudget, ignore } = config as Config;
  const checkBudget = (budget: Budget, where: string) => {
    for (const [key, value] of Object.entries(budget)) {
      if (key === "route") continue;
      if (!(key in METRICS)) {
        throw new Error(`${where}: unknown budget "${key}". Use one of: ${Object.keys(METRICS).join(", ")}.`);
      }
      parseBytes(value as Size);
    }
  };
  if (budgets !== undefined) {
    if (!Array.isArray(budgets)) throw new Error(`"budgets" must be an array.`);
    budgets.forEach((b, i) => {
      if (typeof b?.route !== "string") throw new Error(`budgets[${i}] needs a "route" pattern.`);
      checkBudget(b, `budgets[${i}] (${b.route})`);
    });
  }
  if (defaultBudget !== undefined && defaultBudget !== false) checkBudget(defaultBudget, "defaultBudget");
  if (ignore !== undefined && !Array.isArray(ignore)) throw new Error(`"ignore" must be an array of route patterns.`);
  return config as Config;
}
