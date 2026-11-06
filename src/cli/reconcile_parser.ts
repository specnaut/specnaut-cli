import type { Intent } from "./intent.ts";

/**
 * `specnaut reconcile`'s arguments, validated into its intent: `--status` alone, or one path with
 * exactly one of `--accept-upstream` / `--accept-current`. A refusal is `unknown`, exit 2.
 */
export function parseReconcile(
  parsed: Readonly<Record<string, unknown>>,
  positional: readonly string[],
): Intent {
  const status = Boolean(parsed["status"]);
  const acceptUpstream = Boolean(parsed["accept-upstream"]);
  const acceptCurrent = Boolean(parsed["accept-current"]);

  if (status) {
    if (acceptUpstream || acceptCurrent || positional.length > 0) {
      return { kind: "unknown", received: "reconcile --status takes no other arguments" };
    }
    return { kind: "reconcile-status" };
  }

  if (acceptUpstream && acceptCurrent) {
    return {
      kind: "unknown",
      received: "reconcile --accept-upstream and --accept-current are mutually exclusive",
    };
  }
  if (!acceptUpstream && !acceptCurrent) {
    return {
      kind: "unknown",
      received:
        "specnaut reconcile requires --status, or <path> with --accept-upstream / --accept-current",
    };
  }
  if (positional.length !== 1) {
    return {
      kind: "unknown",
      received: "specnaut reconcile <path> requires exactly one path",
    };
  }
  return {
    kind: "reconcile-path",
    path: positional[0],
    mode: acceptUpstream ? "accept-upstream" : "accept-current",
  };
}
