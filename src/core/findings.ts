import type { ComponentStat, Report } from "./analyze.js";
import { formatBytes, formatPercent } from "./units.js";

export type Severity = "warning" | "info";

export interface Finding {
  rule: "heavy-props" | "repeated-strings" | "module-references" | "large-payload" | "inline-share";
  severity: Severity;
  title: string;
  detail: string;
  /** Bytes the finding is about, used to rank findings. */
  bytes: number;
}

/** Next.js warns when Pages Router page data passes this; App Router has no equivalent warning. */
export const LARGE_PAYLOAD_BYTES = 128_000;

const HEAVY_PROPS_MIN_BYTES = 10_000;
const HEAVY_PROPS_MIN_SHARE = 0.1;
const REPEATED_MIN_BYTES = 5_000;
const INLINE_MIN_BYTES = 20_000;
const INLINE_MIN_SHARE = 0.5;

function depthOf(path: string): number {
  return path.split(".").length;
}

/** The fields worth naming: one level inside the props when a single object prop dominates, else the props. */
export function biggestFields(component: ComponentStat, count = 3): ComponentStat["paths"] {
  const nested = component.paths.filter((p) => depthOf(p.path) === 2);
  const nestedTotal = nested.reduce((sum, p) => sum + p.bytes, 0);
  const pool = nestedTotal >= component.propsBytes / 2 ? nested : component.paths.filter((p) => depthOf(p.path) === 1);
  // A field under 5% of the total is noise next to the ones worth fixing.
  return pool.filter((p) => p.bytes >= component.propsBytes * 0.05).slice(0, count);
}

function heavyProps(report: Report): Finding[] {
  return report.components
    .filter(
      (c) =>
        !c.framework &&
        c.propsBytes >= HEAVY_PROPS_MIN_BYTES &&
        c.propsBytes >= report.payloadBytes * HEAVY_PROPS_MIN_SHARE,
    )
    .map((c) => {
      const share = c.propsBytes / report.payloadBytes;
      const fields = biggestFields(c)
        .map((p) => `${p.path} (${formatBytes(p.bytes)})`)
        .join(", ");
      const instances =
        c.instances > 1
          ? `${c.instances} instances, about ${formatBytes(Math.round(c.propsBytes / c.instances))} each. `
          : "";
      return {
        rule: "heavy-props" as const,
        severity: share >= 0.25 ? ("warning" as const) : ("info" as const),
        title: `${c.name} receives ${formatBytes(c.propsBytes)} of props (${formatPercent(c.propsBytes, report.payloadBytes)} of the payload)`,
        detail:
          `${instances}Biggest fields: ${fields}. ` +
          `Every prop of a client component is serialized into the page. If ${c.name} doesn't render all of this, ` +
          `pick the fields it needs on the server and pass only those.`,
        bytes: c.propsBytes,
      };
    });
}

function repeatedStrings(report: Report): Finding[] {
  const wasted = report.repeatedStrings.reduce((sum, s) => sum + s.wastedBytes, 0);
  if (wasted < REPEATED_MIN_BYTES) return [];
  const top = report.repeatedStrings[0];
  const copies = report.repeatedStrings.reduce((sum, s) => sum + s.count, 0);
  return [
    {
      rule: "repeated-strings",
      severity: wasted >= report.payloadBytes * 0.1 ? "warning" : "info",
      title: `${report.repeatedStrings.length} strings are sent ${copies} times, wasting ${formatBytes(wasted)}`,
      detail:
        `The most repeated: "${top.preview}" (${top.count} copies). ` +
        `React deduplicates repeated references to the same object, but equal strings are sent every time they occur. ` +
        `Send shared text once, for example as a lookup table, or leave it out if the client doesn't show it.`,
      bytes: wasted,
    },
  ];
}

const MODULES_MIN_BYTES = 20_000;
const MODULES_MIN_SHARE = 0.2;

function moduleReferences(report: Report): Finding[] {
  const bytes = report.breakdown.modules;
  if (bytes < MODULES_MIN_BYTES || bytes < report.payloadBytes * MODULES_MIN_SHARE) return [];
  return [
    {
      rule: "module-references",
      severity: "warning",
      title: `${formatBytes(bytes)} of the payload references ${report.clientModules} client modules`,
      detail:
        `Each distinct client component adds a row naming its module and every JavaScript chunk it needs, so this ` +
        `grows with the number of client components and the chunks each pulls in. Components that use no state, ` +
        `effects or browser APIs can go back to being server components, which removes their rows and their JavaScript.`,
      bytes,
    },
  ];
}

function largePayload(report: Report): Finding[] {
  if (report.payloadBytes < LARGE_PAYLOAD_BYTES) return [];
  return [
    {
      rule: "large-payload",
      severity: "warning",
      title: `The RSC payload is ${formatBytes(report.payloadBytes)}`,
      detail:
        `That's over ${formatBytes(LARGE_PAYLOAD_BYTES)}, the threshold for the Pages Router "Large Page Data" warning. ` +
        `The App Router has no equivalent warning, so nothing else will tell you.`,
      bytes: report.payloadBytes,
    },
  ];
}

function inlineShare(report: Report): Finding[] {
  const { documentBytes, inlineBytes } = report;
  if (!documentBytes || !inlineBytes) return [];
  if (inlineBytes < INLINE_MIN_BYTES || inlineBytes < documentBytes * INLINE_MIN_SHARE) return [];
  return [
    {
      rule: "inline-share",
      severity: "info",
      title: `The inline RSC payload is ${formatPercent(inlineBytes, documentBytes)} of the HTML document`,
      detail:
        `${formatBytes(inlineBytes)} of the ${formatBytes(documentBytes)} document is the payload repeated as script tags. ` +
        `The browser downloads and parses it before hydration completes, and client-side navigation fetches it again.`,
      bytes: inlineBytes,
    },
  ];
}

export function findings(report: Report): Finding[] {
  // Actionable warnings first; the overall size warning sums them up, so it follows them.
  const rank = (f: Finding) => (f.severity === "info" ? 2 : f.rule === "large-payload" ? 1 : 0);
  return [
    ...heavyProps(report),
    ...repeatedStrings(report),
    ...moduleReferences(report),
    ...largePayload(report),
    ...inlineShare(report),
  ].sort(
    (a, b) => rank(a) - rank(b) || b.bytes - a.bytes,
  );
}
