/**
 * Parser for the React Flight wire format: the RSC payload React streams to the browser.
 *
 * A payload is a sequence of rows. Each row starts with a hex id and a colon (`3:`), then either:
 *   - a JSON value (a "model" row: elements, props, any serialized data), ended by a newline
 *   - a one-letter tag followed by data ended by a newline (`I` client module import, `H` hint, `E` error...)
 *   - a length-prefixed tag (`T1a4,` followed by 0x1a4 bytes of text, or a typed array) with no terminator
 *
 * The grammar mirrors processBinaryChunk in react-client/src/ReactFlightClient.js. Lengths are in UTF-8 bytes,
 * so the parser works on bytes rather than on a JS string.
 */

export type RowKind =
  /** A JSON value: an element tree, props, or data referenced from elsewhere. */
  | "model"
  /** `I`: a reference to a client component module and the chunks that load it. */
  | "import"
  /** `H`: a resource hint such as a stylesheet or font preload. */
  | "hint"
  /** `T`: a long string sent out of line. */
  | "text"
  /** A typed array or binary chunk. */
  | "binary"
  /** `E`: a serialized error. */
  | "error"
  /** `D`, `W`, `N`, `J`: dev-only debug info, console replays and timing. */
  | "debug"
  /** Anything else (`X`, stream controls, tags from newer React versions). */
  | "other";

export interface FlightRow {
  /** Hex row id as written on the wire. Hint rows have an empty id. */
  id: string;
  kind: RowKind;
  /** The tag character, or "" for model rows. */
  tag: string;
  /** Bytes this row occupies on the wire, including its id, tag and terminator. */
  bytes: number;
  /** Parsed JSON for model, import, hint, error and debug rows. Undefined if it did not parse. */
  value?: unknown;
  /** The decoded text of a `T` row. */
  text?: string;
}

export interface FlightPayload {
  rows: FlightRow[];
  /** First row for each id. A streamed value can span several rows that share an id. */
  byId: Map<string, FlightRow>;
  /** Total size in UTF-8 bytes. */
  bytes: number;
}

const LENGTH_PREFIXED = new Set("TAOobUSsLlGgMmV");
const DEBUG_TAGS = new Set("DWNJ");
const decoder = new TextDecoder();
const encoder = new TextEncoder();

const COLON = 0x3a;
const COMMA = 0x2c;
const NEWLINE = 0x0a;

function isHexDigit(byte: number): boolean {
  return (byte >= 0x30 && byte <= 0x39) || (byte >= 0x61 && byte <= 0x66) || (byte >= 0x41 && byte <= 0x46);
}

function isTag(byte: number): boolean {
  // React treats A-Z, '#', 'r', 'x' and the typed-array tags as row tags. Anything else starts a JSON value,
  // which can only begin with one of {["-0123456789tfn, none of which are tags.
  return (
    (byte >= 0x41 && byte <= 0x5a) ||
    byte === 0x23 ||
    byte === 0x72 ||
    byte === 0x78 ||
    LENGTH_PREFIXED.has(String.fromCharCode(byte))
  );
}

function kindOf(tag: string): RowKind {
  if (tag === "") return "model";
  if (tag === "I") return "import";
  if (tag === "H") return "hint";
  if (tag === "T") return "text";
  if (tag === "E") return "error";
  if (DEBUG_TAGS.has(tag)) return "debug";
  if (LENGTH_PREFIXED.has(tag)) return "binary";
  return "other";
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function parseFlight(input: string | Uint8Array): FlightPayload {
  const data = typeof input === "string" ? encoder.encode(input) : input;
  const rows: FlightRow[] = [];
  const byId = new Map<string, FlightRow>();
  let i = 0;

  while (i < data.length) {
    const start = i;

    // Blank lines between rows are harmless; skip them rather than reading them as a row.
    if (data[i] === NEWLINE) {
      i++;
      continue;
    }

    while (i < data.length && isHexDigit(data[i])) i++;
    if (data[i] !== COLON) {
      throw new FlightParseError(`Not an RSC payload: expected a row such as \`0:[...]\` at byte ${start}`, start);
    }
    const id = decoder.decode(data.subarray(start, i));
    i++;

    let tag = "";
    if (i < data.length && isTag(data[i])) {
      tag = String.fromCharCode(data[i]);
      i++;
    }

    const kind = kindOf(tag);
    let row: FlightRow;

    if (LENGTH_PREFIXED.has(tag)) {
      const lengthStart = i;
      while (i < data.length && data[i] !== COMMA) i++;
      const length = parseInt(decoder.decode(data.subarray(lengthStart, i)), 16);
      if (Number.isNaN(length) || data[i] !== COMMA) {
        throw new FlightParseError(`Malformed length for "${tag}" row ${id} at byte ${lengthStart}`, lengthStart);
      }
      i++;
      const body = data.subarray(i, i + length);
      i += length;
      row = { id, kind, tag, bytes: i - start };
      if (tag === "T") row.text = decoder.decode(body);
    } else {
      let end = data.indexOf(NEWLINE, i);
      if (end === -1) end = data.length;
      const body = decoder.decode(data.subarray(i, end));
      i = end + 1;
      row = { id, kind, tag, bytes: Math.min(i, data.length) - start };
      // A hint row is `:H` + a one-letter hint code + JSON, e.g. `:HL["/style.css","style"]`.
      const json = tag === "H" ? body.slice(1) : body;
      if (json.length > 0) row.value = tryParse(json);
    }

    rows.push(row);
    if (id !== "" && !byId.has(id)) byId.set(id, row);
  }

  return { rows, byId, bytes: data.length };
}

export class FlightParseError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
    this.name = "FlightParseError";
  }
}

/** UTF-8 byte length of a string, without allocating. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      // A surrogate pair is one 4-byte code point.
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
