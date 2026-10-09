import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { BUCKET_LABELS, formatBytes, formatPercent, propTree, type Bucket, type ComponentStat, type Report } from "rscope";
import { BUCKET_COLORS } from "../lib/colors";
import { squarify, type Placed } from "../lib/squarify";

interface Tile {
  key: string;
  label: string;
  /** Shown on hover: the full path. */
  detail: string;
  bytes: number;
  bucket: Bucket;
  shade: number;
}

interface Group {
  key: string;
  label: string;
  bytes: number;
  bucket: Bucket;
  tiles: Tile[];
}

/** Splits a component into the fields worth seeing: the children of a dominant prop, else the props themselves. */
function fieldTiles(component: ComponentStat): Tile[] {
  const tiles: Tile[] = [];
  const nodes = propTree(component, 8, 2);
  for (const node of nodes) {
    const childBytes = node.children.reduce((sum, c) => sum + c.bytes, 0);
    const split = node.children.length > 1 && childBytes >= node.bytes * 0.6 && node.bytes >= component.propsBytes * 0.2;
    const parts = split ? node.children : [node];
    for (const part of parts) {
      tiles.push({
        key: `${component.moduleId}:${part.path}`,
        label: split ? `${node.name}${part.name}` : node.name,
        detail: `${component.name} › ${part.path}`,
        bytes: part.bytes,
        bucket: "clientProps",
        shade: tiles.length,
      });
    }
    if (split && node.bytes - childBytes > 0) {
      tiles.push({
        key: `${component.moduleId}:${node.path}:rest`,
        label: `${node.name} (rest)`,
        detail: `${component.name} › other fields of ${node.path}`,
        bytes: node.bytes - childBytes,
        bucket: "clientProps",
        shade: tiles.length,
      });
    }
  }
  const covered = tiles.reduce((sum, t) => sum + t.bytes, 0);
  if (component.propsBytes - covered > 0) {
    tiles.push({
      key: `${component.moduleId}:keys`,
      label: "keys & small fields",
      detail: `${component.name} › prop names and smaller fields`,
      bytes: component.propsBytes - covered,
      bucket: "clientProps",
      shade: tiles.length,
    });
  }
  return tiles;
}

function groups(report: Report): Group[] {
  const result: Group[] = [];
  const minimum = report.payloadBytes * 0.01;
  let smallProps = 0;
  for (const component of report.components) {
    if (component.framework || component.propsBytes === 0) continue;
    if (component.propsBytes < minimum) {
      smallProps += component.propsBytes;
      continue;
    }
    const instances = component.instances > 1 ? ` ×${component.instances}` : "";
    result.push({
      key: `${component.moduleId}#${component.exportName}`,
      label: `${component.name}${instances}`,
      bytes: component.propsBytes,
      bucket: "clientProps",
      tiles: fieldTiles(component),
    });
  }
  const single = (bucket: Bucket, label: string, bytes: number): Group => ({
    key: bucket + label,
    label,
    bytes,
    bucket,
    tiles: [{ key: bucket + label, label, detail: label, bytes, bucket, shade: 0 }],
  });
  if (smallProps > 0) result.push(single("clientProps", "Smaller client components", smallProps));
  for (const bucket of ["serverTree", "frameworkProps", "modules", "hints", "other"] as const) {
    if (report.breakdown[bucket] > 0) result.push(single(bucket, BUCKET_LABELS[bucket], report.breakdown[bucket]));
  }
  return result;
}

const HEADER = 22;

export function Treemap({ report }: { report: Report }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [active, setActive] = useState<Tile | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const data = useMemo(() => groups(report), [report]);

  const layout = useMemo(() => {
    if (size.w === 0) return [];
    return squarify(data, (g) => g.bytes, { x: 0, y: 0, w: size.w, h: size.h }).map((group) => {
      const labelled = group.item.tiles.length > 1 && group.h > HEADER * 2.5 && group.w > 90;
      const inner = { x: 0, y: labelled ? HEADER : 0, w: group.w, h: group.h - (labelled ? HEADER : 0) };
      return { group, labelled, tiles: squarify(group.item.tiles, (t) => t.bytes, inner) };
    });
  }, [data, size]);

  const shown = active ?? data[0]?.tiles[0] ?? null;

  return (
    <figure className="treemap-figure">
      <div className="treemap" ref={ref} role="list" aria-label="Byte map of the payload">
        {layout.map(({ group, labelled, tiles }) => (
          <div
            key={group.item.key}
            className={`treemap-group bucket-${group.item.bucket}`}
            style={{ left: group.x, top: group.y, width: group.w, height: group.h }}
          >
            {labelled && (
              <div className="treemap-group-label">
                <span>{group.item.label}</span>
                <span className="mono">{formatBytes(group.item.bytes)}</span>
              </div>
            )}
            {tiles.map((tile: Placed<Tile>) => (
              <div
                key={tile.item.key}
                role="listitem"
                tabIndex={0}
                aria-label={`${tile.item.detail}: ${formatBytes(tile.item.bytes)}`}
                className={`treemap-tile${active?.key === tile.item.key ? " is-active" : ""}`}
                style={{
                  left: tile.x,
                  top: tile.y,
                  width: tile.w,
                  height: tile.h,
                  background: BUCKET_COLORS[tile.item.bucket],
                  filter: tile.item.bucket === "clientProps" ? `brightness(${1 - (tile.item.shade % 4) * 0.07})` : undefined,
                }}
                onMouseEnter={() => setActive(tile.item)}
                onFocus={() => setActive(tile.item)}
              >
                {tile.w > 70 && tile.h > 34 && (
                  <span className="tile-label">
                    <span>{labelled || group.item.tiles.length === 1 ? tile.item.label : group.item.label}</span>
                    <span className="mono">{formatBytes(tile.item.bytes)}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <figcaption className="treemap-readout" aria-live="polite">
        {shown && (
          <>
            <span className="swatch" style={{ background: BUCKET_COLORS[shown.bucket] }} />
            <span className="readout-path">{shown.detail}</span>
            <span className="mono">{formatBytes(shown.bytes)}</span>
            <span className="mono muted">{formatPercent(shown.bytes, report.payloadBytes)} of the payload</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}
