import { useState } from "react";
import { formatBytes, formatPercent, propTree, type ComponentStat, type PropNode, type Report as ReportData } from "rscope";
import type { Analysis } from "../lib/analysis";
import { ByteStrip } from "./ByteStrip";
import { Treemap } from "./Treemap";

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>
        <span className="stat-value">{value}</span>
        {note && <span className="stat-note">{note}</span>}
      </dd>
    </div>
  );
}

function PropRows({ nodes, max, depth = 0 }: { nodes: PropNode[]; max: number; depth?: number }) {
  return (
    <ul className="props" style={{ ["--depth" as string]: depth }}>
      {nodes.map((node) => (
        <li key={node.path}>
          <div className="prop-row">
            <code>{node.name}</code>
            <span className="prop-bar" aria-hidden>
              <span style={{ width: `${(node.bytes / max) * 100}%` }} />
            </span>
            <span className="mono">{formatBytes(node.bytes)}</span>
          </div>
          {node.children.length > 0 && <PropRows nodes={node.children} max={max} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function ComponentRow({ component, max, open, onToggle }: { component: ComponentStat; max: number; open: boolean; onToggle: () => void }) {
  const expandable = component.paths.length > 0;
  return (
    <li className={`component${open ? " is-open" : ""}`}>
      <button type="button" className="component-head" onClick={onToggle} disabled={!expandable} aria-expanded={expandable ? open : undefined}>
        <span className="component-name">
          {component.name}
          {component.instances > 1 && <span className="instances">×{component.instances}</span>}
          {component.source && <small className="mono">{component.source}</small>}
        </span>
        <span className="component-bar" aria-hidden>
          <span style={{ width: `${(component.propsBytes / max) * 100}%` }} />
        </span>
        <span className="mono component-bytes">{formatBytes(component.propsBytes)}</span>
        {expandable && <span className="chevron" aria-hidden>{open ? "−" : "+"}</span>}
      </button>
      {open && (
        <div className="component-body">
          {component.instances > 1 && (
            <p className="muted">
              {component.instances} instances. The largest carries {formatBytes(component.largestInstanceBytes)}.
            </p>
          )}
          <PropRows nodes={propTree(component, 6, 2)} max={component.propsBytes} />
        </div>
      )}
    </li>
  );
}

function Components({ report }: { report: ReportData }) {
  const [showInternals, setShowInternals] = useState(false);
  const all = report.components.filter((c) => c.propsBytes > 0);
  const list = all.filter((c) => showInternals || !c.framework);
  const [open, setOpen] = useState<string | null>(list[0] ? list[0].moduleId + list[0].exportName : null);
  const max = Math.max(1, ...list.map((c) => c.propsBytes));
  const internals = all.length - all.filter((c) => !c.framework).length;

  return (
    <section className="panel" aria-labelledby="components-title">
      <header className="panel-head">
        <h3 id="components-title">Client components by props size</h3>
        {internals > 0 && (
          <label className="toggle">
            <input type="checkbox" checked={showInternals} onChange={(e) => setShowInternals(e.target.checked)} />
            Next.js internals ({internals})
          </label>
        )}
      </header>
      {list.length === 0 ? (
        <p className="muted">No client component receives props on this page.</p>
      ) : (
        <ul className="components">
          {list.map((c) => {
            const key = c.moduleId + c.exportName;
            return <ComponentRow key={key} component={c} max={max} open={open === key} onToggle={() => setOpen(open === key ? null : key)} />;
          })}
        </ul>
      )}
    </section>
  );
}

function Findings({ report }: { report: ReportData }) {
  return (
    <section className="panel" aria-labelledby="findings-title">
      <header className="panel-head">
        <h3 id="findings-title">Findings</h3>
      </header>
      {report.findings.length === 0 ? (
        <p className="all-clear">Nothing stands out. This payload is lean.</p>
      ) : (
        <ol className="findings">
          {report.findings.map((f, i) => (
            <li key={i} className={`finding severity-${f.severity}`}>
              <strong>{f.title}</strong>
              <p>{f.detail}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RepeatedStrings({ report }: { report: ReportData }) {
  if (report.repeatedStrings.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="repeated-title">
      <header className="panel-head">
        <h3 id="repeated-title">Repeated strings</h3>
        <span className="muted">React deduplicates shared objects, not equal strings</span>
      </header>
      <table className="repeated">
        <thead>
          <tr>
            <th scope="col">Copies</th>
            <th scope="col">String</th>
            <th scope="col">Wasted</th>
          </tr>
        </thead>
        <tbody>
          {report.repeatedStrings.slice(0, 6).map((s) => (
            <tr key={s.preview}>
              <td className="mono">{s.count}×</td>
              <td>
                <code>{s.preview}</code>
              </td>
              <td className="mono">{formatBytes(s.wastedBytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function Report({ analysis }: { analysis: Analysis }) {
  const { report, gzip, label } = analysis;
  return (
    <article className="report" aria-labelledby="report-title">
      <header className="report-head">
        <p className="eyebrow">Report</p>
        <h2 id="report-title" className="mono">{label}</h2>
      </header>

      <dl className="stats">
        <Stat label="RSC payload" value={formatBytes(report.payloadBytes)} note={`${report.rows} rows`} />
        <Stat label="Gzipped" value={gzip ? formatBytes(gzip.payload) : "–"} note="what travels over the wire" />
        <Stat
          label="Client props"
          value={formatPercent(report.breakdown.clientProps, report.payloadBytes)}
          note={`${formatBytes(report.breakdown.clientProps)} of the payload`}
        />
        {report.documentBytes && report.inlineBytes ? (
          <Stat
            label="Of the HTML"
            value={formatPercent(report.inlineBytes, report.documentBytes)}
            note={`payload inside a ${formatBytes(report.documentBytes)} document`}
          />
        ) : (
          <Stat label="Client modules" value={String(report.clientModules)} note="referenced by the payload" />
        )}
      </dl>

      <h3 className="section-label">Where the bytes go</h3>
      <ByteStrip report={report} />

      <h3 className="section-label">
        Byte map <span className="muted">hover a box to see the field</span>
      </h3>
      <Treemap report={report} />

      <div className="report-grid">
        <Components key={label} report={report} />
        <Findings report={report} />
      </div>
      <RepeatedStrings report={report} />
    </article>
  );
}
