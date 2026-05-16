export interface HeadingNode {
  level: number;
  text: string;
  children: HeadingNode[];
}

export function flattenHeadings(tree: HeadingNode[]): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  const walk = (nodes: HeadingNode[]) => {
    for (const n of nodes) {
      out.push({ level: n.level, text: n.text });
      if (n.children?.length) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

export function headingTreeToMarkdown(tree: HeadingNode[]): string {
  const lines: string[] = [];
  const walk = (nodes: HeadingNode[]) => {
    for (const n of nodes) {
      const prefix = '#'.repeat(n.level);
      lines.push(`${prefix} ${n.text}`);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(tree);
  return lines.join('\n');
}

export function validateHeadingTree(tree: unknown): tree is HeadingNode[] {
  if (!Array.isArray(tree)) return false;
  const walk = (nodes: unknown[]): boolean => {
    for (const n of nodes) {
      if (!n || typeof n !== 'object') return false;
      const node = n as Record<string, unknown>;
      if (typeof node.level !== 'number' || node.level < 2 || node.level > 6) return false;
      if (typeof node.text !== 'string') return false;
      if (node.children !== undefined) {
        if (!Array.isArray(node.children)) return false;
        if (!walk(node.children)) return false;
      }
    }
    return true;
  };
  return walk(tree);
}
