import { isFullSha } from "../domain/commit_sha.ts";
import type { Intent } from "./intent.ts";

/**
 * `specnaut review gate|guard|start|end`'s arguments, validated into its intent. `gate` and
 * `guard` take none (their input is a hook's, on stdin); `start` one source, a PR number or
 * `<remote>/<branch>`, judged by the export; `end` one full commit id. A refusal is `unknown`,
 * exit 2 with the help.
 *
 * `start` takes no option and no `--`, read from the raw argument list: the checkout gate lets a
 * start through only when its line reads `review start`, so a spelling the parser would also
 * accept as a start (`review --force start 12`, `review -- start 12`) must not start one.
 */
export function parseReview(rest: readonly string[], argv: readonly string[]): Intent {
  const [sub, ...words] = rest;
  const refused = (why: string): Intent => ({ kind: "unknown", received: `review ${why}` });
  if (sub === "gate" || sub === "guard") {
    return words.length === 0 ? { kind: "review", sub } : refused(`${sub} takes no argument`);
  }
  if (sub === "start") {
    if (argv.some((w) => w.startsWith("-"))) return refused("start takes no option");
    if (words.length !== 1 || words[0] === "") return refused("start takes one source");
    return { kind: "review", sub: "start", source: words[0] };
  }
  if (sub === "end") {
    if (words.length !== 1 || !isFullSha(words[0])) return refused("end takes one full commit id");
    return { kind: "review", sub: "end", sha: words[0] };
  }
  return { kind: "unknown", received: `review ${sub ?? ""}`.trim() };
}
