// Shared fixture for the checkout precondition: the verify-scripts fixture's base, with harness
// settings, instructions and Specnaut config committed, a branch `outside` one commit past it, and
// the user's checkout at the base, where the session's start record is taken. The use cases run in
// process, through their real adapters.

import { recordCheckout } from "../../src/application/record_checkout.ts";
import { type CheckoutOutcome, verifyCheckout } from "../../src/application/verify_checkout.ts";
import { findHarness } from "../../src/cli/harnesses.ts";
import { FsSessionRecords } from "../../src/infrastructure/fs_session_records.ts";
import { FsScriptTreeWalker } from "../../src/infrastructure/fs_script_tree_walker.ts";
import { FsTreeWalker } from "../../src/infrastructure/fs_tree_walker.ts";
import { GitObjects } from "../../src/infrastructure/git_object_reader.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import {
  bundled,
  commitAll,
  fixture,
  git,
  GIT_READ,
  LOCK,
  write,
} from "./verify_scripts_fixture.ts";

export const SETTINGS = ".claude/settings.json";
export const BASE_FILES = {
  ".specnaut/installed.lock": LOCK,
  [GIT_READ]: bundled(GIT_READ),
  ".specnaut/workflow.yml": "merge: auto\n",
  [SETTINGS]: "{}\n",
  "AGENTS.md": "rules\n",
  ".gitignore": ".claude/settings.local.json\n",
};

/**
 * The fixture, plus a branch `outside` one commit past the base: its head sha. With `prefix`, the
 * project is that folder of the repository, and `project` names it.
 */
export async function setUp(files: Record<string, string> = BASE_FILES, prefix?: string) {
  const { root, project } = await fixture({ files, ...(prefix ? { prefix } : {}) });
  await git(root, "checkout", "-q", "-b", "outside", "main");
  await write(root, { "src/a.ts": "export const a = 1;\n" });
  await commitAll(root, "outside work");
  const head = (await git(root, "rev-parse", "HEAD")).trim();
  await git(root, "checkout", "-q", "feature");
  await startSession(project);
  return { root, project, head };
}

/** The session's record path, by the folder it started in, as `SPECNAUT_SESSION_RECORD` holds it. */
const records = new Map<string, string>();

let sessions = 0;

/**
 * A session starts in `dir`, a new one each call unless `sessionId` names one: its record is taken
 * of the checkout as it is now, or, for a session that has one, kept. It becomes `dir`'s session.
 */
export async function startSession(
  dir: string,
  source = "startup",
  sessionId = `fixture-session-${++sessions}`,
): Promise<string> {
  const store = (await FsSessionRecords.open(dir))!;
  const git = await GitObjects.open(dir);
  const outcome = await recordCheckout(
    { git, checkout: new FsTreeWalker(dir), records: store },
    { sessionId, source },
  );
  if (outcome.kind !== "taken" && outcome.kind !== "existing") {
    throw new Error(`no record: ${JSON.stringify(outcome)}`);
  }
  records.set(dir, outcome.path);
  return outcome.path;
}

/**
 * Moves the base forward by `change`, committed and pushed, brings the checkout to its tip, and
 * starts a new session there: one started before would have loaded the old base.
 */
export async function onBase(root: string, change: () => Promise<void>) {
  await git(root, "checkout", "-q", "main");
  await change();
  await commitAll(root, "base moves");
  await git(root, "push", "-q", "origin", "main");
  await git(root, "checkout", "-q", "feature");
  await git(root, "merge", "-q", "--ff-only", "main");
  await startSession(root);
}

/**
 * The check, run in `root` by the session that started there, or by one whose
 * `SPECNAUT_SESSION_RECORD` is `session.named` (`undefined`: the variable is not set).
 */
export async function check(
  root: string,
  head: string,
  session: { named: string | undefined } = { named: records.get(root) },
): Promise<CheckoutOutcome> {
  const { named } = session;
  return await verifyCheckout({
    git: await GitObjects.open(root),
    walker: new FsScriptTreeWalker(root),
    checkout: new FsTreeWalker(root),
    session: (await FsSessionRecords.open(root))!.reader(named),
    core: CORE_BUNDLE,
    findHarness,
  }, head);
}

export const reasons = (o: CheckoutOutcome) => o.kind === "restart" ? o.reasons : [];
