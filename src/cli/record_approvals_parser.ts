import { isFullSha } from "../domain/commit_sha.ts";
import type { Intent } from "./intent.ts";
import { SHA256 } from "./verify_scripts_parser.ts";

/**
 * `specnaut record-approvals`: the instructions digest a yes covers, and the commits it was judged
 * at (record_approvals_handler.ts).
 */
export type RecordApprovalsIntent = {
  kind: "record-approvals";
  digest: string;
  head: string;
  baseTip: string;
};

/** Each flag `record-approvals` takes, with the form its value must have. */
const RECORD_FLAGS: Readonly<Record<string, (v: string) => boolean>> = {
  "--instructions-digest": (v) => SHA256.test(v),
  "--head": isFullSha,
  "--base-tip": isFullSha,
};

/**
 * `specnaut record-approvals --instructions-digest <sha256> --head <sha> --base-tip <sha>`, read
 * from the raw argument list like `verify-scripts`: each flag exactly once, in any order, its value
 * a sha256 digest or a full commit sha. Called by `land-feature.sh` only, after a yes.
 */
export function parseRecordApprovals(argv: readonly string[]): Intent {
  const refused = (): Intent => ({ kind: "unknown", received: "record-approvals usage" });
  const got = new Map<string, string>();
  for (let i = 1; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    const valid = Object.hasOwn(RECORD_FLAGS, flag) ? RECORD_FLAGS[flag] : undefined;
    if (valid === undefined || got.has(flag) || value === undefined || !valid(value)) {
      return refused();
    }
    got.set(flag, value);
  }
  if (argv[0] !== "record-approvals" || got.size !== 3) return refused();
  const [digest, head, baseTip] = Object.keys(RECORD_FLAGS).map((f) => got.get(f)!);
  return { kind: "record-approvals", digest, head, baseTip };
}
