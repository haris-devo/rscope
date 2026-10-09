import { readFile, appendFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { checkBudgets, isIgnored, validateConfig, type Config, type RouteResult } from "../core/budget.js";
import { toMarkdown } from "../core/markdown.js";
import { formatBytes, parseBytes } from "../core/units.js";
import { analyzeTarget, InputError } from "./sources.js";
import { colors, toText } from "./text.js";
import { VERSION } from "./version.js";

const HELP = `rscope ${VERSION}
See what's inside your React Server Components payload.

Usage
  rscope [targets...] [options]

Targets (default: .next)
  .next, or a project directory     every prerendered App Router route from \`next build\`
  page.html, page.rsc                a saved document or raw RSC payload
  https://example.com/page           a live page (use --rsc for the client navigation payload)

Options
  --budget <size>     payload budget for routes without one in the config (default 128 kB)
  --config <file>     budget config (default: rscope.config.json, if present)
  --detail            full breakdown for every route (automatic for a single route)
  --all               include Next.js internals in component lists
  --top <n>           components, fields and strings to list (default 5)
  --json              JSON output
  --markdown          Markdown output, for PR comments
  --summary <file>    also append the Markdown report to a file, e.g. "$GITHUB_STEP_SUMMARY"
  --rsc               fetch URLs with the RSC: 1 header instead of as HTML
  --no-color          plain output
  -v, --version
  -h, --help

Exit codes: 0 within budget, 1 over budget, 2 bad input.
`;

async function loadConfig(file: string | undefined): Promise<Config> {
  const path = file ?? "rscope.config.json";
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    if (file) throw new InputError(`Can't read config file ${file}.`);
    return {};
  }
  try {
    return validateConfig(JSON.parse(text));
  } catch (error) {
    throw new InputError(`${path}: ${(error as Error).message}`);
  }
}

function annotate(results: RouteResult[], violations: ReturnType<typeof checkBudgets>): void {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  for (const v of violations) {
    console.log(`::error title=rscope: ${v.route} over budget::${v.metric} is ${formatBytes(v.actual)}, budget ${formatBytes(v.limit)}`);
  }
  for (const result of results) {
    for (const finding of result.report.findings) {
      if (finding.severity === "warning") console.log(`::warning title=rscope: ${result.route}::${finding.title}`);
    }
  }
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      budget: { type: "string" },
      config: { type: "string" },
      detail: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      top: { type: "string", default: "5" },
      json: { type: "boolean", default: false },
      markdown: { type: "boolean", default: false },
      summary: { type: "string" },
      rsc: { type: "boolean", default: false },
      "no-color": { type: "boolean", default: false },
      version: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.version) {
    console.log(VERSION);
    return 0;
  }

  const top = Number(values.top);
  if (!Number.isInteger(top) || top < 1) throw new InputError(`--top must be a positive whole number.`);

  const config = await loadConfig(values.config);
  if (values.budget !== undefined) {
    try {
      config.defaultBudget = { ...(config.defaultBudget || {}), payload: parseBytes(values.budget) };
    } catch (error) {
      throw new InputError(`--budget: ${(error as Error).message}`);
    }
  }

  const targets = positionals.length > 0 ? positionals : [".next"];
  const results: RouteResult[] = [];
  for (const target of targets) results.push(...(await analyzeTarget(target, { rsc: values.rsc })));
  const kept = results.filter((r) => !isIgnored(r.route, config));
  if (kept.length === 0) throw new InputError(`No prerendered App Router routes found in ${targets.join(", ")}.`);

  const violations = checkBudgets(kept, config);

  if (values.json) {
    console.log(JSON.stringify({ version: VERSION, routes: kept, violations }, null, 2));
  } else if (values.markdown) {
    console.log(toMarkdown(kept, violations, { top }));
  } else {
    const color = colors(!values["no-color"] && !process.env.NO_COLOR && (Boolean(process.stdout.isTTY) || Boolean(process.env.FORCE_COLOR)));
    console.log(toText(kept, violations, { color, detail: values.detail, all: values.all, top, label: targets.join(", ") }));
  }

  if (values.summary) await appendFile(values.summary, toMarkdown(kept, violations, { top }));
  annotate(kept, violations);
  return violations.length > 0 ? 1 : 0;
}
