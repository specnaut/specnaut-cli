// Shared fixture for the checkout precondition: the verify-scripts fixture's base, with harness
// settings, instructions and Specnaut config committed, a branch `outside` one commit past it, and
// the user's checkout at the base. The use case runs in process, through its real adapters.

import { type CheckoutOutcome, verifyCheckout } from "../../src/application/verify_checkout.ts";
import { findHarness } from "../../src/cli/harnesses.ts";
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

/** The fixture, plus a branch `outside` one commit past the base: its head sha. */
export async function setUp(files: Record<string, string> = BASE_FILES) {
  const { root } = await fixture({ files });
  await git(root, "checkout", "-q", "-b", "outside", "main");
  await write(root, { "src/a.ts": "export const a = 1;\n" });
  await commitAll(root, "outside work");
  const head = (await git(root, "rev-parse", "HEAD")).trim();
  await git(root, "checkout", "-q", "feature");
  return { root, head };
}

/** Moves the base forward by `change`, committed and pushed, and brings the checkout to its tip. */
export async function onBase(root: string, change: () => Promise<void>) {
  await git(root, "checkout", "-q", "main");
  await change();
  await commitAll(root, "base moves");
  await git(root, "push", "-q", "origin", "main");
  await git(root, "checkout", "-q", "feature");
  await git(root, "merge", "-q", "--ff-only", "main");
}

export async function check(root: string, head: string): Promise<CheckoutOutcome> {
  return await verifyCheckout({
    git: await GitObjects.open(root),
    walker: new FsScriptTreeWalker(root),
    checkout: new FsTreeWalker(root),
    core: CORE_BUNDLE,
    findHarness,
  }, head);
}

export const reasons = (o: CheckoutOutcome) => o.kind === "restart" ? o.reasons : [];
