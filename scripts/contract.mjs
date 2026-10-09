// Contract test against a real Next.js build: run after `next build` in examples/next-shop with whichever Next.js
// version is installed. Fails when a Next.js or React release changes the payload in a way rscope misreads.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const example = path.join(root, "examples/next-shop");
const next = JSON.parse(readFileSync(path.join(example, "node_modules/next/package.json"), "utf8")).version;

let output;
try {
  output = execFileSync("node", [path.join(root, "dist/node/cli.js"), example, "--json", "--budget", "10MB"], { encoding: "utf8" });
} catch (error) {
  console.error(error.stdout, error.stderr);
  throw error;
}
const { routes } = JSON.parse(output);
const failures = [];
const check = (ok, message) => ok || failures.push(message);

const byRoute = Object.fromEntries(routes.map((r) => [r.route, r.report]));
check(byRoute["/products"] && byRoute["/products-lean"], `expected /products and /products-lean, got ${Object.keys(byRoute)}`);

for (const [route, report] of Object.entries(byRoute)) {
  const total = Object.values(report.breakdown).reduce((a, b) => a + b, 0);
  check(total === report.payloadBytes, `${route}: buckets add up to ${total}, payload is ${report.payloadBytes}`);
  check(report.breakdown.other < report.payloadBytes * 0.05, `${route}: ${report.breakdown.other} bytes unclassified`);
}

const card = byRoute["/products"]?.components.find((c) => c.name === "ProductCard");
check(card, "ProductCard not found in /products");
if (card) {
  check(card.instances === 48, `ProductCard: expected 48 instances, got ${card.instances}`);
  check(card.source?.endsWith("components/product-card.tsx"), `ProductCard: source is ${card.source}`);
  check(card.paths.some((p) => p.path === "product.reviews"), "ProductCard: no product.reviews path");
  check(card.propsBytes > byRoute["/products"].payloadBytes * 0.8, "ProductCard: props are not the bulk of the payload");
}

if (failures.length > 0) {
  console.error(`rscope misreads Next.js ${next}:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`rscope reads Next.js ${next} correctly (${routes.length} routes).`);
