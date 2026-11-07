type Node = { toJSON?: () => unknown; components?: unknown };

const toNode = (value: unknown): Node => {
  const node = value as Node;
  return typeof node.toJSON === "function" ? (node.toJSON() as Node) : node;
};

function countNode(value: unknown): number {
  const node = toNode(value);
  const children = Array.isArray(node.components) ? node.components : [];
  return 1 + children.reduce((sum: number, child) => sum + countNode(child), 0);
}

/** Counts every nested component (container, text displays, separators, rows, buttons, selects). */
export function countComponents(payload: { components?: unknown }): number {
  const top = Array.isArray(payload.components) ? payload.components : [];
  return top.reduce((sum: number, child) => sum + countNode(child), 0);
}

/** Cuts to at most `max` characters (code points), ending in "…" when it cut. */
export function truncate(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}
