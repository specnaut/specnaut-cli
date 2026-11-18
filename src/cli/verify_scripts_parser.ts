import type { ApprovalClass } from "../domain/approval_verdict.ts";
import { isFullSha } from "../domain/commit_sha.ts";
import type { Intent } from "./intent.ts";

/** `specnaut verify-scripts`, and the digests a yes covers (verify_scripts_handler.ts). */
export type VerifyScriptsIntent = {
  kind: "verify-scripts";
  approved: { scripts?: string; instructions?: string };
};

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

/** The flag that names each class's approved digest. */
const FLAGS: Readonly<Record<string, ApprovalClass>> = {
  "--approved-scripts": "scripts",
  "--approved-instructions": "instructions",
};

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * `specnaut verify-scripts [--approved-scripts <sha256>] [--approved-instructions <sha256>]`,
 * read word by word from the raw argument list: the command first, then each flag at most once,
 * followed by its digest as 64 lowercase hex digits. The digests come from the command line only:
 * the yes they carry is the merge phase's, never a value a file of the tree could set. Anything
 * else is `unknown`, exit 2 with the help.
 */
export function parseVerifyScripts(argv: readonly string[]): Intent {
  const refused = (why: string): Intent => ({ kind: "unknown", received: `verify-scripts ${why}` });
  if (argv[0] !== "verify-scripts") return refused("takes its flags after the command");
  const approved: { scripts?: string; instructions?: string } = {};
  for (let i = 1; i < argv.length; i += 2) {
    const cls = Object.hasOwn(FLAGS, argv[i]) ? FLAGS[argv[i]] : undefined;
    if (cls === undefined) {
      return refused("takes only --approved-scripts and --approved-instructions");
    }
    if (approved[cls] !== undefined) return refused(`takes --approved-${cls} once`);
    const digest = argv[i + 1];
    if (digest === undefined || !SHA256.test(digest)) {
      return refused(`--approved-${cls} takes one sha256 digest`);
    }
    approved[cls] = digest;
  }
  return { kind: "verify-scripts", approved };
}

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
