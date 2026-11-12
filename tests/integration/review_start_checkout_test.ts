import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { CHANGED_PASS, startReview } from "../../src/application/review_start.ts";
import type { BranchExport } from "../../src/application/untrusted_review.ts";
import { baseTipOf } from "../../src/application/verify_scripts.ts";
import { openGate, runReviewGate } from "../../src/cli/handlers/review_gate_handler.ts";
import { sha256HexBytes } from "../../src/domain/sha256.ts";
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

async function gate(root: string, sessionId: string): Promise<number> {
  const input = () => Promise.resolve(hook(sessionId));
  return await runReviewGate({ cwd: root, input, err: () => {}, open: openGate });
}

/** The start as `specnaut review start` runs it in `root`, the export stood in for. */
async function start(root: string) {
  const exported = { sha: "a".repeat(40), keep: () => {} } as BranchExport;
  return await startReview({
    pass: (await FsReviewPass.open(root))!,
    now: Date.now,
    baseTip: async () => await baseTipOf(await GitObjects.open(root)),
    checkout: () => checkoutState(root),
    exportBranch: () => Promise.resolve(exported),
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

  for (const [i, [name, commands]] of Object.entries(MOVES).entries()) {
    // A new session each time: the gate refuses one whose HEAD visited another branch since.
    await startSession(root, "startup", `moved-session-${i}`);
    assertEquals(await gate(root, `moved-session-${i}`), 0, name);
    for (const command of commands) await git(root, ...command);
    assertEquals(await start(root), { kind: "refused", why: CHANGED_PASS }, name);
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
