/** Sizes use decimal units (1 kB = 1000 bytes), like Next.js, Lighthouse and Chrome DevTools. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${trim((bytes / 1000).toFixed(1))} kB`;
  return `${trim((bytes / 1_000_000).toFixed(2))} MB`;
}

/** "128.0" → "128", "1.50" → "1.5" */
function trim(number: string): string {
  return number.replace(/\.?0+$/, "");
}

export function formatPercent(part: number, whole: number): string {
  if (whole === 0) return "0%";
  const percent = (part / whole) * 100;
  return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

const UNITS: Record<string, number> = { b: 1, kb: 1000, k: 1000, mb: 1_000_000, m: 1_000_000, kib: 1024, mib: 1024 * 1024 };

/** Parses "128kB", "128 kB", "1.5 MB", "64KiB" or a plain number of bytes. */
export function parseBytes(input: string | number): number {
  if (typeof input === "number") return input;
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(input);
  const unit = match ? UNITS[(match[2] || "b").toLowerCase()] : undefined;
  if (!match || unit === undefined) throw new Error(`Can't read "${input}" as a size. Use something like "128 kB".`);
  return Math.round(Number(match[1]) * unit);
}
