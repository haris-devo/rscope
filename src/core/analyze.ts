import { parseFlight, utf8Length, type FlightPayload, type FlightRow } from "./flight.js";
import { extractFlight, hasNextData } from "./extract.js";
import { findings as buildFindings, type Finding } from "./findings.js";

/** Where a byte of the payload ends up. Every byte belongs to exactly one bucket. */
export type Bucket =
  /** Data passed as props to your own client components. */
  | "clientProps"
  /** Data passed as props to Next.js's internal client components (router, metadata, boundaries). */
  | "frameworkProps"
  /** Server-rendered elements, their host props and text, and the router state that frames them. */
  | "serverTree"
  /** References to client component modules and the chunks that load them. */
  | "modules"
  /** Stylesheet, font and script preload hints. */
  | "hints"
  /** Debug info, errors, binary chunks and rows nothing references. */
  | "other";

export const BUCKETS: readonly Bucket[] = ["clientProps", "serverTree", "frameworkProps", "modules", "hints", "other"];

export interface ClientModule {
  /** Row id of the `I` row that declares the module. */
  row: string;
  moduleId: string;
  exportName: string;
  chunks: string[];
  /** Source file, when a client reference manifest was available (`rscope` reads it from `.next`). */
  source?: string;
}

export interface PropPath {
  /** e.g. `product`, `product.reviews`, `product.reviews[].body` */
  path: string;
  bytes: number;
}

export interface ComponentStat {
  /** Display name: the export name, or the file name for default exports. */
  name: string;
  moduleId: string;
  exportName: string;
  source?: string;
  /** A Next.js internal (layout router, metadata boundary...) rather than one of your components. */
  framework: boolean;
  instances: number;
  /** Bytes of data in this component's props, summed over every instance. `children` is not data and is excluded. */
  propsBytes: number;
  largestInstanceBytes: number;
  /** Bytes per prop path, summed over instances, down to four levels deep. */
  paths: PropPath[];
}

export interface RepeatedString {
  /** The first 80 characters. */
  preview: string;
  /** Bytes of one copy, as encoded in the payload. */
  bytes: number;
  count: number;
  /** Bytes spent on the copies after the first. */
  wastedBytes: number;
}

export interface Report {
  /** UTF-8 bytes of the RSC payload. */
  payloadBytes: number;
  /** Bytes of the HTML document, when analyzing a document. */
  documentBytes?: number;
  /** Bytes the payload occupies inside the HTML once wrapped in scripts and escaped as JS strings. */
  inlineBytes?: number;
  rows: number;
  /** Distinct client component modules the payload references. */
  clientModules: number;
  breakdown: Record<Bucket, number>;
  /** Client components, largest props first. */
  components: ComponentStat[];
  repeatedStrings: RepeatedString[];
  findings: Finding[];
}

export interface AnalyzeOptions {
  /** Module id → source file, from a Next.js client reference manifest. */
  modules?: ReadonlyMap<string, string>;
}

const MAX_PATH_DEPTH = 4;
const MIN_REPEATED_LENGTH = 64;

/** Exports Next.js renders itself; seen when no manifest is available to say which files they come from. */
const FRAMEWORK_EXPORTS = new Set([
  "ClientPageRoot",
  "ClientSegmentRoot",
  "HTTPAccessFallbackBoundary",
  "IconMark",
  "MetadataBoundary",
  "OutletBoundary",
  "RootLayoutBoundary",
  "ViewportBoundary",
]);

/** Next.js's router and metadata components. `next/link` and `next/image` are not here: their props are yours. */
const NEXT_INTERNALS = /(^|\/)node_modules\/next\/dist\/(esm\/)?(client\/components|lib\/framework|lib\/metadata)\//;

type Sink =
  | { bucket: Exclude<Bucket, "clientProps" | "frameworkProps"> }
  | { bucket: "clientProps" | "frameworkProps"; component: ComponentAcc };

interface ComponentAcc {
  stat: ComponentStat;
  paths: Map<string, number>;
}

const TREE: Sink = { bucket: "serverTree" };
const MODULES: Sink = { bucket: "modules" };

/** React writes row ids in lowercase hex, which keeps `$D` (Date) and `$E` apart from references. */
function isHex(char: string | undefined): boolean {
  return char !== undefined && /^[0-9a-f]$/.test(char);
}

/** Row prefixes that point at another row: `$L` lazy, `$@` promise, `$Q` Map, `$W` Set, `$K` FormData, `$B` Blob, `$F`/`$h` server reference. */
const REF_PREFIXES = new Set(["L", "@", "Q", "W", "K", "B", "F", "h"]);

/** The row id a `$`-string refers to, if it is a reference to another row. */
export function referencedRow(value: string): string | undefined {
  if (value.length < 2 || value[0] !== "$") return undefined;
  const first = value[1];
  let rest: string;
  if (isHex(first)) rest = value.slice(1);
  else if (REF_PREFIXES.has(first) && isHex(value[2])) rest = value.slice(2);
  else return undefined;
  const colon = rest.indexOf(":");
  return colon === -1 ? rest : rest.slice(0, colon);
}

function isElement(value: unknown[]): boolean {
  return value[0] === "$" && value.length >= 4 && (typeof value[1] === "string" || typeof value[1] === "function");
}

function jsonLength(value: string): number {
  return utf8Length(JSON.stringify(value));
}

function baseName(source: string): string {
  const file = source.split("/").pop() ?? source;
  return file.replace(/\.[cm]?[jt]sx?$/, "");
}

class Analyzer {
  readonly buckets: Record<Bucket, number> = {
    clientProps: 0,
    frameworkProps: 0,
    serverTree: 0,
    modules: 0,
    hints: 0,
    other: 0,
  };
  readonly modules = new Map<string, ClientModule>();
  readonly components = new Map<string, ComponentAcc>();
  readonly strings = new Map<string, number>();
  /** Rows already credited. Tracked per row, not per id: a streamed value (`7:X` ... `7:C`) spans rows sharing an id. */
  private readonly visited = new Set<FlightRow>();
  private readonly rowsById = new Map<string, FlightRow[]>();

  constructor(
    private readonly payload: FlightPayload,
    private readonly options: AnalyzeOptions,
  ) {
    for (const row of payload.rows) {
      if (!row.id) continue;
      const group = this.rowsById.get(row.id);
      if (group) group.push(row);
      else this.rowsById.set(row.id, [row]);
    }
  }

  run(): void {
    const { rows } = this.payload;

    // Module rows first, so the chunk-path strings they reference count as module overhead rather than tree.
    for (const row of rows) {
      if (row.kind === "import") this.visitImport(row);
    }
    for (const row of rows) {
      if (row.kind === "hint") this.add({ bucket: "hints" }, row.bytes);
    }

    // Walk the tree from the root so shared rows are credited to the first thing that uses them, then sweep up
    // anything streamed in that the root does not reach (for example rows only the client router reads).
    for (const root of this.rowsById.get("0") ?? []) this.visitRow(root, TREE, "", 0);
    for (const row of rows) {
      if (row.kind === "model" || row.kind === "text") this.visitRow(row, TREE, "", 0);
    }

    for (const row of rows) {
      if (row.kind === "import" || row.kind === "hint" || row.kind === "model" || row.kind === "text") continue;
      if (this.visited.has(row)) continue;
      this.add({ bucket: "other" }, row.bytes);
    }
  }

  private add(sink: Sink, bytes: number): void {
    this.buckets[sink.bucket] += bytes;
  }

  private visitImport(row: FlightRow): void {
    this.visited.add(row);
    this.add(MODULES, row.bytes);

    const value = row.value;
    let moduleId: unknown;
    let chunks: unknown;
    let name: unknown;
    if (Array.isArray(value)) {
      // React 19: [id, chunks, name, async?]
      [moduleId, chunks, name] = value;
    } else if (value && typeof value === "object") {
      // React 18 (Next.js 13 and 14): { id, chunks, name, async }
      ({ id: moduleId, chunks, name } = value as Record<string, unknown>);
    }

    const resolve = (item: unknown): string => {
      if (typeof item !== "string") return String(item ?? "");
      const ref = referencedRow(item);
      if (ref === undefined) return item;
      const target = this.payload.byId.get(ref);
      if (!target || target.kind !== "model") return item;
      if (!this.visited.has(target)) {
        this.visited.add(target);
        this.add(MODULES, target.bytes);
      }
      return typeof target.value === "string" ? target.value : item;
    };

    const id = String(moduleId ?? "");
    this.modules.set(row.id, {
      row: row.id,
      moduleId: id,
      exportName: resolve(name),
      chunks: Array.isArray(chunks) ? chunks.map(resolve) : [],
      source: this.options.modules?.get(id),
    });
  }

  /** Credits a whole row to `sink`, walking into its value. Returns the bytes credited. */
  private visitRow(row: FlightRow, sink: Sink, path: string, depth: number): number {
    if (this.visited.has(row)) return 0;
    this.visited.add(row);

    if (row.kind === "text") {
      this.add(sink, row.bytes);
      if (row.text !== undefined) this.countString(row.text);
      return row.bytes;
    }
    if (row.kind !== "model") {
      this.add({ bucket: sink.bucket === "modules" ? "modules" : "other" }, row.bytes);
      return 0;
    }
    if (row.value === undefined) {
      this.add({ bucket: "other" }, row.bytes);
      return 0;
    }

    const valueBytes = this.visit(row.value, sink, path, depth);
    // The row's id prefix and newline travel with its value.
    const overhead = row.bytes - this.encodedLength(row.value);
    this.add(sink, overhead);
    return valueBytes + overhead;
  }

  private encodedLength(value: unknown): number {
    return utf8Length(JSON.stringify(value) ?? "");
  }

  /**
   * Credits the JSON encoding of `value` to `sink`, except for nested elements: their framing is server tree and
   * their props go to whichever component receives them. Returns the bytes credited to `sink`.
   */
  private visit(value: unknown, sink: Sink, path: string, depth: number): number {
    let bytes = 0;

    if (value === null) {
      bytes = 4;
      this.add(sink, bytes);
    } else if (typeof value === "string") {
      bytes = jsonLength(value);
      this.add(sink, bytes);
      const ref = referencedRow(value);
      if (ref !== undefined) {
        for (const target of this.rowsById.get(ref) ?? []) bytes += this.visitRow(target, sink, path, depth);
      } else if (value.length >= MIN_REPEATED_LENGTH && !value.startsWith("$")) {
        this.countString(value);
      }
    } else if (typeof value === "number" || typeof value === "boolean") {
      bytes = String(value).length;
      this.add(sink, bytes);
    } else if (Array.isArray(value)) {
      if (isElement(value)) {
        this.visitElement(value);
        return 0;
      }
      bytes = 2 + Math.max(0, value.length - 1);
      this.add(sink, bytes);
      for (const item of value) bytes += this.visit(item, sink, path ? `${path}[]` : path, depth);
    } else if (typeof value === "object") {
      const entries = Object.entries(value);
      bytes = 2 + Math.max(0, entries.length - 1);
      for (const [key] of entries) bytes += jsonLength(key) + 1;
      this.add(sink, bytes);
      for (const [key, child] of entries) {
        bytes += this.visit(child, sink, path ? `${path}.${key}` : key, depth + 1);
      }
    }

    // Array items share their array's path with "[]" appended; the array itself already records their total.
    if ("component" in sink && path && !path.endsWith("[]") && depth > 0 && depth <= MAX_PATH_DEPTH) {
      sink.component.paths.set(path, (sink.component.paths.get(path) ?? 0) + bytes);
    }
    return bytes;
  }

  /** `["$", type, key, props, ...devInfo]` */
  private visitElement(element: unknown[]): void {
    const [marker, type, key, props, ...rest] = element;
    this.add(TREE, 2 + (element.length - 1) + jsonLength(String(marker)));
    this.visit(type, TREE, "", 0);
    this.visit(key, TREE, "", 0);
    for (const item of rest) this.visit(item, TREE, "", 0);

    const component = typeof type === "string" ? this.componentFor(type, props) : undefined;
    if (!component || !props || typeof props !== "object" || Array.isArray(props)) {
      this.visit(props, TREE, "", 0);
      return;
    }

    const sink: Sink = { bucket: component.stat.framework ? "frameworkProps" : "clientProps", component };
    const entries = Object.entries(props);
    this.add(TREE, 2 + Math.max(0, entries.length - 1));

    let instanceBytes = 0;
    for (const [name, value] of entries) {
      const keyBytes = jsonLength(name) + 1;
      if (name === "children") {
        // Children are rendered output that passes through the component, not data it receives.
        this.add(TREE, keyBytes);
        this.visit(value, TREE, "", 0);
        continue;
      }
      this.add(sink, keyBytes);
      instanceBytes += keyBytes + this.visit(value, sink, name, 1);
    }

    const stat = component.stat;
    stat.instances++;
    stat.propsBytes += instanceBytes;
    stat.largestInstanceBytes = Math.max(stat.largestInstanceBytes, instanceBytes);
  }

  private componentFor(type: string, props: unknown): ComponentAcc | undefined {
    const ref = referencedRow(type);
    if (ref === undefined) return undefined;
    const module = this.modules.get(ref);
    if (!module) return undefined;

    const key = `${module.moduleId}#${module.exportName}`;
    let component = this.components.get(key);
    if (!component) {
      const anonymous = module.exportName === "default" || module.exportName === "*" || module.exportName === "";
      const propNames = props && typeof props === "object" ? Object.keys(props) : [];
      let name = anonymous ? (module.source ? baseName(module.source) : `default (module ${module.moduleId})`) : module.exportName;
      let framework = module.source ? NEXT_INTERNALS.test(module.source) : FRAMEWORK_EXPORTS.has(module.exportName);
      if (propNames.includes("parallelRouterKey")) {
        name = "LayoutRouter";
        framework = true;
      }
      component = {
        stat: {
          name,
          moduleId: module.moduleId,
          exportName: module.exportName,
          source: module.source,
          framework,
          instances: 0,
          propsBytes: 0,
          largestInstanceBytes: 0,
          paths: [],
        },
        paths: new Map(),
      };
      this.components.set(key, component);
    }
    return component;
  }

  private countString(value: string): void {
    if (value.length < MIN_REPEATED_LENGTH) return;
    this.strings.set(value, (this.strings.get(value) ?? 0) + 1);
  }

  repeatedStrings(): RepeatedString[] {
    const repeated: RepeatedString[] = [];
    for (const [value, count] of this.strings) {
      if (count < 2) continue;
      const bytes = jsonLength(value);
      repeated.push({
        preview: value.length > 80 ? `${value.slice(0, 79)}…` : value,
        bytes,
        count,
        wastedBytes: bytes * (count - 1),
      });
    }
    return repeated.sort((a, b) => b.wastedBytes - a.wastedBytes);
  }

  componentStats(): ComponentStat[] {
    return [...this.components.values()]
      .map(({ stat, paths }) => ({
        ...stat,
        paths: [...paths].map(([path, bytes]) => ({ path, bytes })).sort((a, b) => b.bytes - a.bytes),
      }))
      .sort((a, b) => b.propsBytes - a.propsBytes);
  }
}

function buildReport(flight: string | Uint8Array, options: AnalyzeOptions, document?: Pick<Report, "documentBytes" | "inlineBytes">): Report {
  const payload = parseFlight(flight);
  const analyzer = new Analyzer(payload, options);
  analyzer.run();

  const report: Report = {
    payloadBytes: payload.bytes,
    ...document,
    rows: payload.rows.length,
    clientModules: new Set([...analyzer.modules.values()].map((m) => m.moduleId)).size,
    breakdown: analyzer.buckets,
    components: analyzer.componentStats(),
    repeatedStrings: analyzer.repeatedStrings(),
    findings: [],
  };
  report.findings = buildFindings(report);
  return report;
}

/** Analyzes a raw RSC payload: an `.rsc` file, or the body of a request made with the `RSC: 1` header. */
export function analyzeFlight(flight: string | Uint8Array, options: AnalyzeOptions = {}): Report {
  return buildReport(flight, options);
}

export class NoPayloadError extends Error {
  constructor(readonly reason: "pages-router" | "not-next") {
    super(
      reason === "pages-router"
        ? "This is a Pages Router page: it ships __NEXT_DATA__, not an RSC payload. rscope analyzes App Router pages."
        : "No inline RSC payload (self.__next_f) found. Is this a Next.js App Router page?",
    );
    this.name = "NoPayloadError";
  }
}

/** Analyzes a server-rendered App Router HTML document and the RSC payload inlined in it. */
export function analyzeDocument(html: string, options: AnalyzeOptions = {}): Report {
  const extracted = extractFlight(html);
  if (!extracted) throw new NoPayloadError(hasNextData(html) ? "pages-router" : "not-next");

  return buildReport(extracted.flight, options, { documentBytes: utf8Length(html), inlineBytes: extracted.inlineBytes });
}

/** Decides whether text is an HTML document or a raw payload, and analyzes it accordingly. */
export function analyze(input: string, options: AnalyzeOptions = {}): Report {
  return /^\s*</.test(input) ? analyzeDocument(input, options) : analyzeFlight(input, options);
}
