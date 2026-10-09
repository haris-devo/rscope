export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed<T> extends Rect {
  item: T;
}

/**
 * Squarified treemap layout (Bruls, Huizing and van Wijk, 2000): lays items out in rows along the shorter side,
 * adding to a row while that keeps its rectangles closer to square.
 */
export function squarify<T>(items: T[], value: (item: T) => number, rect: Rect): Placed<T>[] {
  const sorted = items.filter((item) => value(item) > 0).sort((a, b) => value(b) - value(a));
  const total = sorted.reduce((sum, item) => sum + value(item), 0);
  if (total === 0) return [];
  const scale = (rect.w * rect.h) / total;
  const areas = sorted.map((item) => ({ item, area: value(item) * scale }));

  const placed: Placed<T>[] = [];
  let free = { ...rect };
  let row: typeof areas = [];

  const worst = (candidate: typeof areas, side: number) => {
    const sum = candidate.reduce((s, a) => s + a.area, 0);
    let ratio = 0;
    for (const { area } of candidate) {
      ratio = Math.max(ratio, (side * side * area) / (sum * sum), (sum * sum) / (side * side * area));
    }
    return ratio;
  };

  const layoutRow = () => {
    const sum = row.reduce((s, a) => s + a.area, 0);
    const horizontal = free.w >= free.h;
    const thickness = horizontal ? sum / free.h : sum / free.w;
    let offset = 0;
    for (const { item, area } of row) {
      const length = area / thickness;
      placed.push(
        horizontal
          ? { item, x: free.x, y: free.y + offset, w: thickness, h: length }
          : { item, x: free.x + offset, y: free.y, w: length, h: thickness },
      );
      offset += length;
    }
    free = horizontal
      ? { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h }
      : { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness };
    row = [];
  };

  for (const entry of areas) {
    const side = Math.min(free.w, free.h);
    if (row.length === 0 || worst([...row, entry], side) <= worst(row, side)) row.push(entry);
    else {
      layoutRow();
      row.push(entry);
    }
  }
  if (row.length > 0) layoutRow();
  return placed;
}
