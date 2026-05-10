// Pure dedupe heuristic for the gh-issues triage skill. Token-overlap
// Jaccard similarity on issue titles. Fast, deterministic, no API
// dependency. False-positives are surfaced for Kevin's review — never
// auto-closed.

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "with",
  "for",
  "to",
  "on",
  "of",
  "and",
  "or",
  "in",
  "it",
  "at",
  "by",
  "from",
  "this",
  "that",
  "was",
  "be",
  "are",
  "as",
  "but",
  "not",
  "no",
  "if",
  "when",
  "where",
  "why",
  "how",
]);

export function tokenize(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export type DupeBucket = "likely-dupe" | "maybe" | "unrelated";

export function bucketOf(score: number): DupeBucket {
  if (score >= 0.5) return "likely-dupe";
  if (score >= 0.3) return "maybe";
  return "unrelated";
}

export type IssueRef = { number: number; title: string };
export type DupeCandidate = IssueRef & { score: number; bucket: DupeBucket };

/**
 * Returns the top `topN` candidates from `pool` that resemble
 * `targetTitle`, sorted by Jaccard score descending. Excludes the
 * `excludeNumber` issue (typically the target itself). Includes all
 * candidates with score > 0; the caller filters by bucket if it only
 * wants `likely-dupe` / `maybe`.
 */
export function findCandidates(
  targetTitle: string,
  pool: ReadonlyArray<IssueRef>,
  opts: { topN?: number; excludeNumber?: number } = {},
): DupeCandidate[] {
  const topN = opts.topN ?? 3;
  const exclude = opts.excludeNumber;
  const targetTokens = tokenize(targetTitle);
  const scored: DupeCandidate[] = [];
  for (const issue of pool) {
    if (issue.number === exclude) continue;
    const score = jaccard(targetTokens, tokenize(issue.title));
    if (score > 0) {
      scored.push({ ...issue, score, bucket: bucketOf(score) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
