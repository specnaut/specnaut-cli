import { isFullSha } from "../domain/commit_sha.ts";
import type { Intent } from "./intent.ts";

/**
 * `specnaut review gate|start|end`'s arguments, validated into its intent. `gate` takes none (its
 * input is a hook's, on stdin); `start` one source, a PR number or `<remote>/<branch>`, judged by
 * the export; `end` one full commit id. A refusal is `unknown`, exit 2 with the help.
 */
export function parseReview(rest: readonly string[]): Intent {
  const [sub, ...words] = rest;
  const refused = (why: string): Intent => ({ kind: "unknown", received: `review ${why}` });
  if (sub === "gate") {
    return words.length === 0 ? { kind: "review", sub: "gate" } : refused("gate takes no argument");
  }
  if (sub === "start") {
    if (words.length !== 1 || words[0] === "") return refused("start takes one source");
    return { kind: "review", sub: "start", source: words[0] };
  }
  if (sub === "end") {
    if (words.length !== 1 || !isFullSha(words[0])) return refused("end takes one full commit id");
    return { kind: "review", sub: "end", sha: words[0] };
  }
  return { kind: "unknown", received: `review ${sub ?? ""}`.trim() };
}
