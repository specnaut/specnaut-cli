import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  CHANGED_PASS,
  NO_PASS,
  NOT_THIS_COMMAND,
  startReview,
} from "../../src/application/review_start.ts";
import type { BranchExport } from "../../src/application/untrusted_review.ts";
import { baseTipOf } from "../../src/application/verify_scripts.ts";
import { openGate, runReviewGate } from "../../src/cli/handlers/review_gate_handler.ts";
import { sha256HexBytes } from "../../src/domain/sha256.ts";
import { FsReviewLock } from "../../src/infrastructure/fs_review_lock.ts";
import { FsReviewPass } from "../../src/infrastructure/fs_review_pass.ts";
import { checkoutState } from "../../src/infrastructure/git_checkout_state.ts";
import { GitObjects } from "../../src/infrastructure/git_object_reader.ts";
import { setUp, startSession } from "./verify_checkout_fixture.ts";
import { git } from "./verify_scripts_fixture.ts";

/**
 * The gate runs before a shell line, the start inside it: a line that checks out another branch
 * before it starts a review reaches the start with a pass taken on the checkout it left. On real
 * repositories, the gate and the start reading the checkout through the same adapter.
 */

const hook = (sessionId: string) =>
  JSON.stringify({ session_id: sessionId, tool_input: { command: "specnaut review start 12" } });

/** The gate's exit; the nonce on the line it passed goes to {@link passed}. */
async function gate(root: string, sessionId: string): Promise<number> {
  const input = () => Promise.resolve(hook(sessionId));
  const out = (s: string) => {
    const line: string = JSON.parse(s).hookSpecificOutput.updatedInput.command;
    passed = line.match(/^export SPECNAUT_REVIEW_PASS=([0-9a-f]{32}); /)?.[1] ?? null;
  };
  passed = null;
  return await runReviewGate({ cwd: root, input, out, err: () => {}, open: openGate });
}

/** The nonce on the line the last gate passed. */
let passed: string | null = null;

/** The start as `specnaut review start` runs it in `root`, carrying `nonce`; the export stood in for. */
async function start(root: string, nonce: string | null = passed) {
  const exported = { sha: "a".repeat(40), logs: "/cache/logs", keep: () => {} } as BranchExport;
  const lock = await FsReviewLock.open(root, { state: join(root, ".state") });
  return await startReview({
    pass: (await FsReviewPass.open(root))!,
    nonce,
    now: Date.now,
    baseTip: async () => await baseTipOf(await GitObjects.open(root)),
    checkout: () => checkoutState(root),
    lock: (id) => lock.lock(id),
    record: (id, review) => lock.record(id, review),
    exportBranch: () => Promise.resolve(exported),
    toolchain: () => Promise.resolve([]),
  }, "12");
}

/** Each moves the checkout the way a line could between its gate and its start. */
const MOVES: Record<string, string[][]> = {
  "another branch": [["checkout", "-q", "outside"]],
  "a new branch at the same commit": [["checkout", "-q", "-b", "pr-12"]],
  "the branch alone": [["branch", "pr-13"], ["symbolic-ref", "HEAD", "refs/heads/pr-13"]],
  "HEAD reset where it stood": [["reset", "-q", "--soft", "HEAD"]],
};

Deno.test("a start in the checkout its gate judged starts; one after the checkout moved does not", async () => {
  const { root } = await setUp();
  await startSession(root, "startup", "control-session");
  assertEquals(await gate(root, "control-session"), 0);
  assertEquals((await start(root)).kind, "started", "the control: an unchanged checkout starts");
  const lock = await FsReviewLock.open(root, { state: join(root, ".state") });
  const base = await baseTipOf(await GitObjects.open(root));
  const recorded = { head: "a".repeat(40), logs: "/cache/logs", base, toolchain: [] };
  assertEquals(await lock.held("control-session"), recorded, "the start locks the session judged");
  assertEquals(await lock.held("moved-session-0"), null, "and no other");

  for (const [i, [name, commands]] of Object.entries(MOVES).entries()) {
    // A new session each time: the gate refuses one whose HEAD visited another branch since.
    await startSession(root, "startup", `moved-session-${i}`);
    assertEquals(await gate(root, `moved-session-${i}`), 0, name);
    for (const command of commands) await git(root, ...command);
    assertEquals(await start(root), { kind: "refused", why: CHANGED_PASS }, name);
    assertEquals(await lock.held(`moved-session-${i}`), null, `${name}: a refusal locks nothing`);
    await git(root, "checkout", "-q", "-f", "feature");
  }
});

Deno.test("the checkout reads as git tells it: HEAD's commit, its branch or none, its reflog's digest", async () => {
  const { root } = await setUp();
  const said = async (...args: string[]) => (await git(root, ...args)).trim();
  const reflog = async () =>
    await sha256HexBytes(await Deno.readFile(join(root, ".git", "logs", "HEAD")));
  assertEquals(await checkoutState(root), {
    head: await said("rev-parse", "HEAD"),
    ref: "refs/heads/feature",
    reflog: await reflog(),
  });
  await git(root, "checkout", "-q", "--detach", "outside");
  assertEquals(await checkoutState(root), {
    head: await said("rev-parse", "outside"),
    ref: null,
    reflog: await reflog(),
  });
});

Deno.test("a start takes only the pass its own line was passed with: not one run outside the hook, nor in another checkout", async () => {
  const [{ root: here }, { root: there }] = [await setUp(), await setUp()];
  await startSession(here, "startup", "here-session");
  await startSession(there, "startup", "there-session");
  assertEquals(await gate(here, "here-session"), 0);
  const ours = passed;
  assertEquals(await gate(there, "there-session"), 0);
  assertEquals(
    await start(there, ours),
    { kind: "refused", why: NOT_THIS_COMMAND },
    "a line passed here",
  );
  assertEquals(await gate(there, "there-session"), 0);
  assertEquals(
    await start(there, null),
    { kind: "refused", why: NOT_THIS_COMMAND },
    "outside the hook",
  );
  assertEquals(
    await start(there, null),
    { kind: "refused", why: NO_PASS },
    "the pass is taken once",
  );
  assertEquals((await start(here, ours)).kind, "started", "the line the gate passed starts");
});
