import type { ApprovalClass } from "../domain/approval_verdict.ts";
import type { Intent } from "./intent.ts";

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
