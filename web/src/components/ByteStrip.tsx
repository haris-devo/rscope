import { BUCKETS, BUCKET_LABELS, formatBytes, formatPercent, type Report } from "rscope";
import { BUCKET_COLORS, BUCKET_NOTES } from "../lib/colors";

export function ByteStrip({ report }: { report: Report }) {
  const buckets = BUCKETS.filter((b) => report.breakdown[b] > 0);
  return (
    <figure className="strip">
      <div className="strip-bar" role="img" aria-label={buckets.map((b) => `${BUCKET_LABELS[b]} ${formatPercent(report.breakdown[b], report.payloadBytes)}`).join(", ")}>
        {buckets.map((b) => (
          <span
            key={b}
            className="strip-segment"
            style={{ flexGrow: report.breakdown[b], background: BUCKET_COLORS[b] }}
            title={`${BUCKET_LABELS[b]}: ${formatBytes(report.breakdown[b])}`}
          />
        ))}
      </div>
      <figcaption>
        <ul className="legend">
          {buckets.map((b) => (
            <li key={b}>
              <span className="swatch" style={{ background: BUCKET_COLORS[b] }} />
              <span className="legend-label">
                {BUCKET_LABELS[b]}
                <small>{BUCKET_NOTES[b]}</small>
              </span>
              <span className="mono legend-value">{formatBytes(report.breakdown[b])}</span>
              <span className="mono legend-share">{formatPercent(report.breakdown[b], report.payloadBytes)}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
