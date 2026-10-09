import { useState } from "react";

const TERMINAL = `$ next build && npx rscope

rscope · .next · 3 routes

     Route            Payload    gzip  Document  Client props       Largest client component
  ✓  /                 3.8 kB  1.4 kB    6.1 kB           9 B  <1%  CartBadge  9 B
  ✖  /products       132.7 kB  5.9 kB  157.6 kB      126.9 kB  96%  ProductCard ×48  126.9 kB
  ✓  /products-lean   10.9 kB  2.4 kB   27.2 kB        5.3 kB  48%  LeanProductCard ×48  5.3 kB

✖ /products is over budget: payload 132.7 kB > 128 kB`;

const ACTION = `# .github/workflows/ci.yml
- run: npm run build
- uses: haris-devo/rscope@v0
  with:
    budget: 100kB   # or keep budgets in rscope.config.json`;

const CONFIG = `// rscope.config.json
{
  "budgets": [
    { "route": "/products/**", "payload": "100kB", "clientProps": "40kB" },
    { "route": "/blog/*", "payload": "60kB" }
  ],
  "defaultBudget": { "payload": "128kB" },
  "ignore": ["/admin/**"]
}`;

const TABS = [
  { id: "cli", label: "Terminal", code: TERMINAL, note: "Reads every prerendered route from .next, with source file names from the build's manifests. Point it at a URL for dynamic routes." },
  { id: "ci", label: "GitHub Actions", code: ACTION, note: "Writes the report to the job summary, annotates routes over budget and fails the job." },
  { id: "config", label: "Budgets", code: CONFIG, note: "Budget the raw payload, the gzipped payload, the whole document or just client props, per route pattern." },
];

export function Usage() {
  const [tab, setTab] = useState(TABS[0].id);
  const [copied, setCopied] = useState(false);
  const current = TABS.find((t) => t.id === tab)!;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(current.code.replace(/^\$ /, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the code is still selectable.
    }
  };

  return (
    <section className="usage" id="cli" aria-labelledby="usage-title">
      <div className="usage-copy">
        <h2 id="usage-title" className="section-title">
          Same analysis, in your terminal and CI
        </h2>
        <p>
          The CLI has no dependencies and runs on Node 20 or later. It exits with 1 when a route is over budget, so a
          bloated page fails the pull request that introduced it, not a Lighthouse run a month later.
        </p>
        <p className="muted">{current.note}</p>
      </div>
      <div className="code-card">
        <div className="tabs" role="tablist" aria-label="Usage">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
          <button type="button" className="copy" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre role="tabpanel">
          <code>{current.code}</code>
        </pre>
      </div>
    </section>
  );
}
