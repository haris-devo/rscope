/** Gzipped size, using the browser's own CompressionStream. */
export async function gzipSize(data: string | Uint8Array): Promise<number> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return (await new Response(stream).arrayBuffer()).byteLength;
}
