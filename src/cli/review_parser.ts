import { isFullSha } from "../domain/commit_sha.ts";
import type { Intent } from "./intent.ts";

/**
 * `specnaut review gate|guard|start|end`'s arguments, validated into its intent. `gate` and
 * `guard` take none (their input is a hook's, on stdin); `start` one source, a PR number or
 * `<remote>/<branch>`, judged by the export; `trust` two words, a PR number and a commit id, judged
 * by the decision so that every malformed one prints `untrusted`; `end` one full commit id. A refusal is `unknown`,
 * exit 2 with the help.
 *
 * `start` takes no option and no `--`, read from the raw argument list: the checkout gate lets a
 * start through only when its line reads `review start`, so a spelling the parser would also
 * accept as a start (`review --force start 12`, `review -- start 12`) must not start one. The one
 * exception is `--expect <sha>` as its last two words: the head the forge reported, a full commit
 * id, so that a fetch landing on any other head is refused.
 */
export function parseReview(rest: readonly string[], argv: readonly string[]): Intent {
  const [sub, ...words] = rest;
  const refused = (why: string): Intent => ({ kind: "unknown", received: `review ${why}` });
  if (sub === "gate" || sub === "guard") {
    return words.length === 0 ? { kind: "review", sub } : refused(`${sub} takes no argument`);
  }
  if (sub === "start") return parseStart(argv, refused);
  if (sub === "trust") {
    if (words.length !== 2) return refused("trust takes one PR number and one commit id");
    return { kind: "review", sub: "trust", pr: words[0], head: words[1] };
  }
  if (sub === "end") {
    if (words.length !== 1 || !isFullSha(words[0])) return refused("end takes one full commit id");
    return { kind: "review", sub: "end", sha: words[0] };
  }
  return { kind: "unknown", received: `review ${sub ?? ""}`.trim() };
}

/** `review start <source>`, then `--expect <sha>` or nothing, read word by word from `argv`. */
function parseStart(argv: readonly string[], refused: (why: string) => Intent): Intent {
  const expects = argv.at(-2) === "--expect";
  const words = expects ? argv.slice(0, -2) : argv;
  if (words.some((w) => w.startsWith("-"))) return refused("start takes no option");
  if (words.length !== 3 || words[2] === "") return refused("start takes one source");
  if (!expects) return { kind: "review", sub: "start", source: words[2] };
  const expect = argv.at(-1)!;
  if (!isFullSha(expect)) return refused("start --expect takes one full commit id");
  return { kind: "review", sub: "start", source: words[2], expect };
}
