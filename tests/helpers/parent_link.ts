// Pure helpers for inspecting and emitting the parent/child link
// convention used by the local Markdown backlog backend.
//
// The local scripts (`add.sh --parent <num>`, `cascade-check`-style
// queries, future tooling) write `parent: "#NNN"` into the frontmatter
// of a child task. These helpers mirror that convention so unit tests
// can verify shell-script output without re-implementing parsing.
//
// Convention:
//   parent: "#NNN"   — child of issue NNN
//   parent: null     — top-level (or omit the key entirely)

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const PARENT_RE = /^parent:\s*(?:"#(\d+)"|#?(\d+))\s*$/m;

/**
 * Extract the parent issue number from a task file's content.
 *
 * Returns the parent number as a string (preserving zero-padding when
 * the source value used it) or `null` when the task has no parent —
 * either the key is absent, the value is the literal `null`, the
 * frontmatter is malformed, or the file is empty.
 *
 * Only the first `parent:` line inside the frontmatter wins; lines
 * outside the frontmatter fences are ignored.
 */
export function extractParent(content: string): string | null {
  if (!content) return null;
  const fmMatch = FRONTMATTER_RE.exec(content);
  if (!fmMatch) return null;
  const fm = fmMatch[1];
  const m = PARENT_RE.exec(fm);
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}

/**
 * Emit the canonical `parent: "#NNN"` frontmatter line for a given
 * parent issue number. Numbers below 1000 are zero-padded to 3 digits
 * to match the auto-numbering convention used by `add.sh`.
 *
 * Throws on non-positive integers — `parent: "#000"` and `parent: "#-1"`
 * are nonsense in this convention.
 */
export function formatParentFrontmatter(num: number): string {
  if (!Number.isInteger(num) || num < 1) {
    throw new Error(`parent number must be a positive integer, got ${num}`);
  }
  const padded = num < 1000 ? String(num).padStart(3, "0") : String(num);
  return `parent: "#${padded}"`;
}

/**
 * Walk a backlog directory and return the absolute paths of every
 * `.md` task file whose frontmatter declares the given parent number.
 *
 * Result is sorted by directory listing order (typically file-name
 * alphabetical, which mirrors task-number order). Non-`.md` files are
 * ignored, as are files without a recognisable `parent:` line.
 */
export async function findChildren(
  dir: string,
  parentNum: string,
): Promise<string[]> {
  const target = parentNum.replace(/^#/, "");
  const out: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const path = `${dir}/${entry.name}`;
    const content = await Deno.readTextFile(path);
    const found = extractParent(content);
    if (found === null) continue;
    if (found === target || found.replace(/^0+/, "") === target.replace(/^0+/, "")) {
      out.push(path);
    }
  }
  return out.sort();
}
