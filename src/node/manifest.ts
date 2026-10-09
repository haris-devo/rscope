import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

/**
 * Builds a module id → source file map from the client reference manifests Next.js writes next to each page
 * (`.next/server/app/**\/page_client-reference-manifest.js`). With it, rscope can say a component lives in
 * `components/product-card.tsx` instead of "module 21871".
 */
export async function readClientModules(appDir: string, projectRoot: string): Promise<Map<string, string>> {
  const modules = new Map<string, string>();
  for (const file of await findFiles(appDir, (name) => name.endsWith("_client-reference-manifest.js"))) {
    let manifests: Record<string, { clientModules?: Record<string, { id?: unknown }> }>;
    try {
      manifests = evaluateManifest(await readFile(file, "utf8"));
    } catch {
      continue;
    }
    for (const manifest of Object.values(manifests)) {
      for (const [key, entry] of Object.entries(manifest.clientModules ?? {})) {
        const id = entry?.id;
        if (id === undefined || id === null) continue;
        const source = cleanSource(key, projectRoot);
        const existing = modules.get(String(id));
        // A module can appear under several keys; prefer the one that names a file in the project.
        if (!existing || (existing.includes("node_modules/") && !source.includes("node_modules/"))) {
          modules.set(String(id), source);
        }
      }
    }
  }
  return modules;
}

/** The manifest is a script that assigns to `globalThis.__RSC_MANIFEST`. Run it in an empty context to read it. */
function evaluateManifest(code: string): Record<string, { clientModules?: Record<string, { id?: unknown }> }> {
  const context = vm.createContext({});
  vm.runInContext("var self = globalThis;", context);
  vm.runInContext(code, context, { timeout: 1000 });
  return JSON.parse(JSON.stringify((context as { __RSC_MANIFEST?: object }).__RSC_MANIFEST ?? {}));
}

/** `[project]/components/card.tsx <module evaluation>` or `/abs/path/components/card.tsx#Card` → `components/card.tsx` */
export function cleanSource(key: string, projectRoot: string): string {
  let source = key
    .replace(/\s*<[^>]*>\s*$/, "")
    .replace(/#.*$/, "")
    .replace(/^\[project\]\//, "");
  if (path.isAbsolute(source)) source = path.relative(projectRoot, source);
  return source.split(path.sep).join("/");
}

export async function findFiles(dir: string, accept: (name: string) => boolean): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await findFiles(full, accept)));
    else if (accept(entry.name)) found.push(full);
  }
  return found;
}
