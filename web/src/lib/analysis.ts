import { analyze, extractFlight, type Report } from "rscope";
import { gzipSize } from "./gzip";

export interface Analysis {
  label: string;
  report: Report;
  gzip?: { payload: number; document?: number };
}

export async function runAnalysis(label: string, input: string, modules?: ReadonlyMap<string, string>): Promise<Analysis> {
  const report = analyze(input, { modules });
  const isDocument = report.documentBytes !== undefined;
  const payload = isDocument ? extractFlight(input)!.flight : input;
  try {
    const [payloadGzip, documentGzip] = await Promise.all([
      gzipSize(payload),
      isDocument ? gzipSize(input) : Promise.resolve(undefined),
    ]);
    return { label, report, gzip: { payload: payloadGzip, document: documentGzip } };
  } catch {
    // CompressionStream is missing in some older browsers; sizes without gzip are still useful.
    return { label, report };
  }
}
