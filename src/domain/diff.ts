/**
 * Render a unified-ish diff of two text blobs. Not bit-compatible with
 * `git diff` — just enough to help a human review a local customization
 * against a new template.
 *
 * The output contains:
 *   --- {oldLabel}
 *   +++ {newLabel}
 *   {context lines prefixed with space, added with +, removed with -}
 *
 * Returns an empty string when both inputs are identical.
 */
export function renderUnifiedDiff(
  oldText: string,
  newText: string,
  oldLabel: string,
  newLabel: string,
): string {
  if (oldText === newText) return "";

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  const m = oldLines.length;
  const n = newLines.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  const out: string[] = [];
  out.push(`--- ${oldLabel}`);
  out.push(`+++ ${newLabel}`);

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      out.push(` ${oldLines[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push(`-${oldLines[i]}`);
      i++;
    } else {
      out.push(`+${newLines[j]}`);
      j++;
    }
  }
  while (i < m) {
    out.push(`-${oldLines[i]}`);
    i++;
  }
  while (j < n) {
    out.push(`+${newLines[j]}`);
    j++;
  }

  return out.join("\n") + "\n";
}
