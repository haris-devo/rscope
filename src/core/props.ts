import type { ComponentStat, PropPath } from "./analyze.js";

export interface PropNode extends PropPath {
  /** The path relative to its parent, for display: `.reviews` under `product`, `[].href` under `items`. */
  name: string;
  children: PropNode[];
}

/** `product.reviews[].body` → `product.reviews`; top-level props → "". */
export function parentPath(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(0, dot).replace(/(\[\])+$/, "");
}

/** Arranges a component's flat prop paths into a tree, keeping the `limit` largest at each level. */
export function propTree(component: ComponentStat, limit = 5, depth = 2): PropNode[] {
  const byParent = new Map<string, PropPath[]>();
  for (const p of component.paths) {
    const parent = parentPath(p.path);
    const list = byParent.get(parent);
    if (list) list.push(p);
    else byParent.set(parent, [p]);
  }

  const build = (parent: string, level: number): PropNode[] =>
    (byParent.get(parent) ?? []).slice(0, limit).map((p) => ({
      ...p,
      name: p.path.slice(parent.length),
      children: level < depth ? build(p.path, level + 1) : [],
    }));

  return build("", 1);
}
