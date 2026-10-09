import type { ComponentStat, Report } from "../core/analyze.js";
import { BUCKETS } from "../core/analyze.js";
import { METRICS, type RouteResult, type Violation } from "../core/budget.js";
import { BUCKET_LABELS } from "../core/markdown.js";
import { propTree, type PropNode } from "../core/props.js";
import { formatBytes, formatPercent } from "../core/units.js";

export interface Colors {
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  cyan(text: string): string;
}

export function colors(enabled: boolean): Colors {
  const wrap = (open: number, close: number) => (text: string) =>
    enabled ? `\u001b[${open}m${text}\u001b[${close}m` : text;
  return { bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), green: wrap(32, 39), yellow: wrap(33, 39), cyan: wrap(36, 39) };
}

// ANSI codes take no space on screen, so pad by visible length.
const visible = (text: string) => text.replace(/\u001b\[\d+m/g, "").length;
const padEnd = (text: string, width: number) => text + " ".repeat(Math.max(0, width - visible(text)));
const padStart = (text: string, width: number) => " ".repeat(Math.max(0, width - visible(text))) + text;

function table(rows: string[][], align: ("left" | "right")[]): string[] {
  const widths = align.map((_, i) => Math.max(...rows.map((row) => visible(row[i] ?? ""))));
  return rows.map((row) =>
    row
      .map((cell, i) => (align[i] === "right" ? padStart(cell, widths[i]) : padEnd(cell, widths[i])))
      .join("  ")
      .trimEnd(),
  );
}

function bar(part: number, whole: number, width = 24): string {
  const filled = whole === 0 ? 0 : Math.round((part / whole) * width);
  return "█".repeat(filled) + " ".repeat(width - filled);
}

export interface TextOptions {
  color: Colors;
  /** Show the full breakdown for each route. */
  detail: boolean;
  /** Include Next.js internals in component lists. */
  all: boolean;
  top: number;
  label: string;
}

function largestComponent(report: Report): ComponentStat | undefined {
  return report.components.find((c) => !c.framework && c.propsBytes > 0);
}

export function summaryTable(results: RouteResult[], violations: Violation[], c: Colors): string[] {
  const over = new Set(violations.map((v) => v.route));
  const header = ["", "Route", "Payload", "gzip", "Document", "Client props", "", "Largest client component"].map((h) =>
    c.dim(h),
  );
  const rows = results.map((result) => {
    const { report } = result;
    const top = largestComponent(report);
    return [
      over.has(result.route) ? c.red("✖") : c.green("✓"),
      c.bold(result.route),
      formatBytes(report.payloadBytes),
      result.gzip ? c.dim(formatBytes(result.gzip.payload)) : c.dim("–"),
      report.documentBytes ? formatBytes(report.documentBytes) : c.dim("–"),
      formatBytes(report.breakdown.clientProps),
      c.dim(formatPercent(report.breakdown.clientProps, report.payloadBytes)),
      top ? `${top.name}${top.instances > 1 ? c.dim(` ×${top.instances}`) : ""}  ${formatBytes(top.propsBytes)}` : c.dim("–"),
    ];
  });
  return table([header, ...rows], ["left", "left", "right", "right", "right", "right", "right", "left"]).map(
    (line) => `  ${line}`,
  );
}

function propLines(nodes: PropNode[], level: number, c: Colors): string[][] {
  const indent = "  ".repeat(level + 1);
  return nodes.flatMap((node) => [
    [`${indent}${node.name}`, c.dim(formatBytes(node.bytes))],
    ...propLines(node.children, level + 1, c),
  ]);
}

export function routeDetail(result: RouteResult, options: TextOptions): string[] {
  const { color: c, top } = options;
  const { report } = result;
  const lines: string[] = [];

  const gzip = result.gzip ? c.dim(` (gzip ${formatBytes(result.gzip.payload)})`) : "";
  let headline = `${c.bold(result.route)}  payload ${c.bold(formatBytes(report.payloadBytes))}${gzip}`;
  if (report.documentBytes && report.inlineBytes) {
    headline += c.dim(`  ·  ${formatPercent(report.inlineBytes, report.documentBytes)} of a ${formatBytes(report.documentBytes)} document`);
  }
  lines.push(headline, "");

  lines.push(`  ${c.bold("Where the bytes go")}`);
  const bucketRows = BUCKETS.filter((b) => report.breakdown[b] > 0).map((bucket) => [
    BUCKET_LABELS[bucket],
    formatBytes(report.breakdown[bucket]),
    c.cyan(bar(report.breakdown[bucket], report.payloadBytes)),
    c.dim(formatPercent(report.breakdown[bucket], report.payloadBytes)),
  ]);
  lines.push(...table(bucketRows, ["left", "right", "left", "right"]).map((l) => `    ${l}`), "");

  const components = report.components.filter((comp) => (options.all || !comp.framework) && comp.propsBytes > 0);
  if (components.length > 0) {
    lines.push(`  ${c.bold("Client components by props size")}`);
    const rows: string[][] = [];
    for (const comp of components.slice(0, top)) {
      rows.push([
        `${comp.name}${comp.framework ? c.dim(" (Next.js)") : ""}`,
        formatBytes(comp.propsBytes),
        c.dim(comp.instances > 1 ? `×${comp.instances}` : ""),
        c.dim(comp.source ?? ""),
      ]);
      // Fields are only worth listing when the component carries real weight.
      if (comp.propsBytes >= 1000) {
        for (const [name, size] of propLines(propTree(comp, top, 2), 0, c)) rows.push([c.dim(name), size, "", ""]);
      }
    }
    lines.push(...table(rows, ["left", "right", "left", "left"]).map((l) => `    ${l}`));
    if (components.length > top) lines.push(c.dim(`    …and ${components.length - top} more`));
    lines.push("");
  }

  if (report.repeatedStrings.length > 0) {
    lines.push(`  ${c.bold("Repeated strings")}`);
    const rows = report.repeatedStrings
      .slice(0, top)
      .map((s) => [`${s.count}×`, c.dim(JSON.stringify(s.preview.length > 60 ? `${s.preview.slice(0, 59)}…` : s.preview)), `${formatBytes(s.wastedBytes)} wasted`]);
    lines.push(...table(rows, ["right", "left", "right"]).map((l) => `    ${l}`), "");
  }

  if (report.findings.length > 0) {
    lines.push(`  ${c.bold("Findings")}`);
    for (const finding of report.findings) {
      const icon = finding.severity === "warning" ? c.yellow("▲") : c.cyan("●");
      lines.push(`    ${icon} ${finding.title}`);
      for (const line of wrap(finding.detail, 92)) lines.push(c.dim(`      ${line}`));
    }
    lines.push("");
  }
  return lines;
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

export function toText(results: RouteResult[], violations: Violation[], options: TextOptions): string {
  const c = options.color;
  const lines: string[] = [];
  const count = `${results.length} route${results.length === 1 ? "" : "s"}`;
  lines.push(`${c.bold("rscope")} ${c.dim(`· ${options.label} · ${count}`)}`, "");

  const detailed = options.detail || results.length === 1;
  if (results.length > 1) lines.push(...summaryTable(results, violations, c), "");
  if (detailed) {
    for (const result of results) lines.push(...routeDetail(result, options));
  }

  if (violations.length > 0) {
    for (const v of violations) {
      lines.push(
        `${c.red("✖")} ${c.bold(v.route)} is over budget: ${METRICS[v.metric]} ${c.red(formatBytes(v.actual))} > ${formatBytes(v.limit)}`,
      );
    }
  } else {
    lines.push(`${c.green("✓")} All routes within budget.`);
  }
  if (!detailed) lines.push(c.dim("  Run with --detail, or on a single route, to see where the bytes go."));
  return lines.join("\n");
}
