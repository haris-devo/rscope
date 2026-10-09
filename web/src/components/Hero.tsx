import { BUCKETS, formatBytes, type Report } from "rscope";
import { BUCKET_COLORS } from "../lib/colors";

interface Row {
  route: string;
  report: Report;
}

export function Hero({ rows, onAnalyze }: { rows: Row[]; onAnalyze: () => void }) {
  const max = Math.max(1, ...rows.map((r) => r.report.payloadBytes));
  const [bloated, lean] = rows;
  const ratio = bloated && lean ? Math.round(bloated.report.payloadBytes / lean.report.payloadBytes) : undefined;

  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow reveal">Open source · Next.js App Router · React Server Components</p>
        <h1 className="reveal">
          See what's inside your <em>RSC payload</em>.
        </h1>
        <p className="lede reveal">
          In the App Router, every prop a server component hands to a client component is serialized into the page, and
          fetched again on client navigation. rscope tells you which components and which fields those bytes belong to,
          and fails CI when a route goes over budget.
        </p>
        <div className="hero-actions reveal">
          <button type="button" className="primary" onClick={onAnalyze}>
            Analyze a page
          </button>
          <code className="command">npx rscope</code>
        </div>
      </div>

      <figure className="compare reveal" aria-label="Payload size of the same page built two ways">
        {rows.map(({ route, report }) => (
          <div key={route} className="compare-row">
            <span className="mono compare-route">{route}</span>
            <span className="compare-track">
              <span className="compare-bar" style={{ width: `${(report.payloadBytes / max) * 100}%` }}>
                {BUCKETS.filter((b) => report.breakdown[b] > 0).map((b) => (
                  <span key={b} style={{ flexGrow: report.breakdown[b], background: BUCKET_COLORS[b] }} />
                ))}
              </span>
            </span>
            <span className="mono compare-size">{formatBytes(report.payloadBytes)}</span>
          </div>
        ))}
        <figcaption>
          The same product grid, built twice with Next.js 16. One passes the whole CMS record to each card, the other passes
          the four fields the card renders.{ratio ? <strong> {ratio}× smaller.</strong> : null}{" "}
          <span className="key">
            <span className="swatch" style={{ background: "var(--props)" }} /> client props
          </span>
        </figcaption>
      </figure>
    </section>
  );
}
