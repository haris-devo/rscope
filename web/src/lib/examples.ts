// The same `next build` output the test suite runs against: one grid passes whole CMS records to its client
// cards, the other passes the four fields the card renders.
import products from "../../../test/fixtures/next-shop/.next/server/app/products.html?raw";
import lean from "../../../test/fixtures/next-shop/.next/server/app/products-lean.html?raw";
import productsManifest from "../../../test/fixtures/next-shop/.next/server/app/products/page_client-reference-manifest.js?raw";
import leanManifest from "../../../test/fixtures/next-shop/.next/server/app/products-lean/page_client-reference-manifest.js?raw";

export interface Example {
  id: string;
  route: string;
  label: string;
  html: string;
  /** Module id → source file, which the CLI reads from `.next` itself. */
  modules: Map<string, string>;
}

function projectModules(manifest: string): Map<string, string> {
  const modules = new Map<string, string>();
  for (const [, source, id] of manifest.matchAll(/"\[project\]\/([^"]+?)":\{"id":(\d+)/g)) {
    if (!source.startsWith("node_modules/")) modules.set(id, source);
  }
  return modules;
}

export const EXAMPLES: Example[] = [
  { id: "bloated", route: "/products", label: "passes the whole CMS record", html: products, modules: projectModules(productsManifest) },
  { id: "lean", route: "/products-lean", label: "passes the four fields it renders", html: lean, modules: projectModules(leanManifest) },
];
