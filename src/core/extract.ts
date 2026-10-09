/**
 * Pulls the RSC payload out of a server-rendered Next.js App Router document.
 *
 * Next.js inlines the payload as a series of scripts:
 *   <script>self.__next_f.push([0])</script>                 bootstrap
 *   <script>self.__next_f.push([1,"0:{\"P\":null..."])</script>  a chunk of the payload, as a JS string
 *   <script>self.__next_f.push([3,"<base64>"])</script>         a binary chunk
 * The chunks concatenate to the same stream the client router fetches during navigation.
 */

const PUSH = /<script\b[^>]*>\s*\(?self\.__next_f(?:\s*=\s*self\.__next_f\s*\|\|\s*\[\]\))?\.push\(([\s\S]*?)\)\s*<\/script>/g;

const BOOTSTRAP = 0;
const DATA = 1;
const FORM_STATE = 2;
const BINARY = 3;

export interface ExtractedPayload {
  /** The concatenated payload, ready for parseFlight. */
  flight: Uint8Array;
  /** Bytes the payload scripts take up inside the HTML, including `<script>` tags and JS string escaping. */
  inlineBytes: number;
  /** Number of `self.__next_f.push` scripts found. */
  scripts: number;
}

const encoder = new TextEncoder();

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Returns undefined when the document has no inline RSC payload (Pages Router, or not Next.js at all). */
export function extractFlight(html: string): ExtractedPayload | undefined {
  const parts: Uint8Array[] = [];
  let inlineBytes = 0;
  let scripts = 0;

  for (const match of html.matchAll(PUSH)) {
    const argument = match[1];
    let chunk: unknown;
    try {
      chunk = JSON.parse(argument);
    } catch {
      continue;
    }
    if (!Array.isArray(chunk)) continue;

    scripts++;
    inlineBytes += encoder.encode(match[0]).length;
    const [type, payload] = chunk as [number, unknown];
    if (type === DATA && typeof payload === "string") parts.push(encoder.encode(payload));
    else if (type === BINARY && typeof payload === "string") parts.push(decodeBase64(payload));
    else if (type !== BOOTSTRAP && type !== FORM_STATE) continue;
  }

  if (scripts === 0) return undefined;

  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const flight = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    flight.set(part, offset);
    offset += part.length;
  }
  return { flight, inlineBytes, scripts };
}

/** Whether a document looks like a Pages Router page, which ships `__NEXT_DATA__` instead of an RSC payload. */
export function hasNextData(html: string): boolean {
  return html.includes('id="__NEXT_DATA__"');
}
