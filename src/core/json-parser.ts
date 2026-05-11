import { unified } from "unified";
import remarkParse from "remark-parse";

export function extractJsonBlocks(markdown: string): unknown[] {
  const tree = unified().use(remarkParse).parse(markdown);

  const results: unknown[] = [];

  function walk(node: unknown): void {
    const n = node as Record<string, unknown>;
    if (n.type === "code" && n.lang === "json" && typeof n.value === "string") {
      try {
        results.push(JSON.parse(n.value));
      } catch {
        console.error("Failed to parse JSON block:", n.value);
      }
    }

    if (Array.isArray(n.children)) {
      n.children.forEach(walk);
    }
  }

  walk(tree);

  return results;
}
