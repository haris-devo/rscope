// Rebuilds examples/next-shop and copies its prerendered output into test/fixtures, so tests run against
// payloads from a real `next build`. Run after bumping Next.js: `npm run fixtures`.
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const example = path.join(root, "examples/next-shop");
const next = JSON.parse(readFileSync(path.join(example, "node_modules/next/package.json"), "utf8")).version;

execSync("npx next build", { cwd: example, stdio: "inherit" });

const from = path.join(example, ".next/server/app");
const to = path.join(root, "test/fixtures/next-shop/.next/server/app");
rmSync(path.join(root, "test/fixtures/next-shop"), { recursive: true, force: true });
mkdirSync(to, { recursive: true });

// Only what rscope reads: documents, payloads and client reference manifests.
cpSync(from, to, {
  recursive: true,
  filter: (src) => {
    const name = path.basename(src);
    return !/\.(js|map|json)$/.test(name) || name.endsWith("_client-reference-manifest.js");
  },
});
console.log(`Fixtures updated from Next.js ${next}.`);
