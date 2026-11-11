/**
 * The parser for `containment-exclusions.txt`, the sweep's allow-list: every
 * line is `<path><whitespace><reason>`, `#` starts a comment.
 */

export type Exclusion = { path: string; reason: string };

/** An entry is either `<path>` or `<path>::<method>`; both name the same file. */
export function fileOf(entry: string): string {
  const i = entry.indexOf("::");
  return i === -1 ? entry : entry.slice(0, i);
}

export function readExclusions(text: string): Exclusion[] {
  const out: Exclusion[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const path = t.split(/\s+/)[0];
    const reason = t.slice(path.length).trim();
    out.push({ path, reason });
  }
  return out;
}
