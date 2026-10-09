import type { Bucket } from "rscope";

export const BUCKET_COLORS: Record<Bucket, string> = {
  clientProps: "var(--props)",
  serverTree: "var(--tree)",
  frameworkProps: "var(--framework)",
  modules: "var(--modules)",
  hints: "var(--hints)",
  other: "var(--other)",
};

export const BUCKET_NOTES: Record<Bucket, string> = {
  clientProps: "Data you pass to your \"use client\" components",
  serverTree: "Elements, text and router state rendered on the server",
  frameworkProps: "Props Next.js passes to its own router and metadata components",
  modules: "Which client modules and chunks the page needs",
  hints: "Stylesheet, font and script preloads",
  other: "Debug rows, errors, stream markers",
};
