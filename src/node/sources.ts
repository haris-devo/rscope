import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { analyze, analyzeDocument, analyzeFlight, type AnalyzeOptions } from "../core/analyze.js";
import type { RouteResult } from "../core/budget.js";
import { extractFlight } from "../core/extract.js";
import { findFiles, readClientModules } from "./manifest.js";

/** Next.js's own error pages, which every build has and nobody budgets. */
const INTERNAL_ROUTES = new Set(["/_not-found", "/_global-error"]);

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

function gzipSize(data: string | Uint8Array): number {
  return gzipSync(data).length;
}

function withGzip(route: string, report: RouteResult["report"], payload: Uint8Array, html?: string): RouteResult {
  return {
    route,
    report,
    gzip: { payload: gzipSize(payload), document: html === undefined ? undefined : gzipSize(html) },
  };
}

function analyzeHtml(route: string, html: string, options: AnalyzeOptions): RouteResult {
  const report = analyzeDocument(html, options);
  return withGzip(route, report, extractFlight(html)!.flight, html);
}

function analyzeRsc(route: string, payload: Buffer, options: AnalyzeOptions): RouteResult {
  return withGzip(route, analyzeFlight(payload, options), payload);
}

/** `index.html` → `/`, `blog/hello.html` → `/blog/hello` */
export function routeFromFile(relative: string): string {
  const route = relative
    .split(path.sep)
    .join("/")
    .replace(/\.(html|rsc)$/, "")
    .replace(/(^|\/)index$/, "");
  return `/${route}`.replace(/\/+$/, "") || "/";
}

/** Finds the build output for an app: accepts the project root or its `.next` directory. */
async function resolveBuildDir(dir: string): Promise<string | undefined> {
  for (const candidate of [dir, path.join(dir, ".next")]) {
    try {
      if ((await stat(path.join(candidate, "server", "app"))).isDirectory()) return candidate;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

/** Every prerendered App Router route in a `next build` output directory. */
export async function analyzeBuild(dir: string): Promise<RouteResult[]> {
  const buildDir = await resolveBuildDir(dir);
  if (!buildDir) {
    throw new InputError(
      `No App Router build output in ${dir}. Run \`next build\` first, or point rscope at a URL of a running app.`,
    );
  }
  const appDir = path.join(buildDir, "server", "app");
  const modules = await readClientModules(appDir, path.dirname(path.resolve(buildDir)));
  const options: AnalyzeOptions = { modules };

  // Segment prefetch payloads (`*.segments/`) are slices of the same data; the full `.rsc` is what we want.
  const files = await findFiles(appDir, (name) => name.endsWith(".html") || name.endsWith(".rsc"));
  const byRoute = new Map<string, { html?: string; rsc?: string }>();
  for (const file of files) {
    const relative = path.relative(appDir, file);
    if (relative.split(path.sep).some((part) => part.endsWith(".segments"))) continue;
    const route = routeFromFile(relative);
    if (INTERNAL_ROUTES.has(route)) continue;
    const entry = byRoute.get(route) ?? {};
    if (file.endsWith(".html")) entry.html = file;
    else entry.rsc = file;
    byRoute.set(route, entry);
  }

  const results: RouteResult[] = [];
  for (const [route, { html, rsc }] of byRoute) {
    if (html) {
      const text = await readFile(html, "utf8");
      // A route that renders nothing but a redirect or a Pages Router fallback has no payload; fall back to its .rsc.
      if (extractFlight(text)) {
        results.push(analyzeHtml(route, text, options));
        continue;
      }
    }
    if (rsc) results.push(analyzeRsc(route, await readFile(rsc), options));
  }
  return results.sort((a, b) => a.route.localeCompare(b.route));
}

export async function analyzeUrl(url: URL, options: { rsc?: boolean } = {}): Promise<RouteResult> {
  const headers: Record<string, string> = { "user-agent": "rscope (+https://github.com/haris-devo/rscope)" };
  if (options.rsc) headers.rsc = "1";
  else headers.accept = "text/html";

  let response: Response;
  try {
    response = await fetch(url, { headers, redirect: "follow" });
  } catch (error) {
    throw new InputError(`Couldn't fetch ${url}: ${(error as Error).message}`);
  }
  if (!response.ok) throw new InputError(`${url} responded with ${response.status} ${response.statusText}`);

  const route = new URL(response.url || url).pathname || "/";
  if (options.rsc) return analyzeRsc(route, Buffer.from(await response.arrayBuffer()), {});
  return analyzeHtml(route, await response.text(), {});
}

export async function analyzeFile(file: string): Promise<RouteResult> {
  const data = await readFile(file);
  const label = path.basename(file);
  const text = data.toString("utf8");
  const report = analyze(text);
  if (report.documentBytes !== undefined) return withGzip(label, report, extractFlight(text)!.flight, text);
  return withGzip(label, report, data);
}

/** Analyzes whatever a target names: a URL, an `.html` or `.rsc` file, or a project / `.next` directory. */
export async function analyzeTarget(target: string, options: { rsc?: boolean } = {}): Promise<RouteResult[]> {
  if (/^https?:\/\//i.test(target)) return [await analyzeUrl(new URL(target), options)];

  let info;
  try {
    info = await stat(target);
  } catch {
    throw new InputError(`${target} doesn't exist. Pass a .next directory, an .html or .rsc file, or a URL.`);
  }
  if (info.isDirectory()) return analyzeBuild(target);
  return [await analyzeFile(target)];
}
