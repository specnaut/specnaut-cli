import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { GateDeps } from "../../src/application/review_gate.ts";
import { verifyCheckout } from "../../src/application/verify_checkout.ts";
import { findHarness } from "../../src/cli/harnesses.ts";
import { openGate, runReviewGate } from "../../src/cli/handlers/review_gate_handler.ts";
import { CHECKOUT_REASON } from "../../src/domain/checkout_trust.ts";
import { SESSION_REASON } from "../../src/domain/session_record.ts";
import { FsHeadReflog } from "../../src/infrastructure/fs_head_reflog.ts";
import { FsReviewPass } from "../../src/infrastructure/fs_review_pass.ts";
import { FsScriptTreeWalker } from "../../src/infrastructure/fs_script_tree_walker.ts";
import { FsTreeWalker } from "../../src/infrastructure/fs_tree_walker.ts";
import { GitObjects } from "../../src/infrastructure/git_object_reader.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { exists } from "../helpers/fs_exists.ts";
import { setUp, startSession } from "./verify_checkout_fixture.ts";
import { git } from "./verify_scripts_fixture.ts";

/**
 * `specnaut review gate` as Claude Code runs it before a shell command, on real repositories: the
 * record it judges is the one of the session id on the hook's input, whatever the environment
 * names, and every way the check fails, a throw included, stops the command with exit 2.
 */

const START = "specnaut review start 12";
const hook = (sessionId: string, command = START) => ({
  session_id: sessionId,
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command },
});

async function gate(cwd: string, input: unknown, open: (cwd: string) => GateDeps = openGate) {
  const said: string[] = [];
  const text = () => Promise.resolve(JSON.stringify(input));
  const code = await runReviewGate({ cwd, input: text, err: (s) => said.push(s), open });
  return { code, err: said.join("\n") };
}

const passFile = (root: string) => join(root, ".git", "specnaut", "review-pass.json");

Deno.test("the gate judges the record of the hook's session id, never the one SPECNAUT_SESSION_RECORD names", async () => {
  const { root } = await setUp();
  await git(root, "checkout", "-q", "outside");
  await startSession(root, "startup", "current-session");
  await git(root, "checkout", "-q", "feature");
  const clean = await startSession(root, "startup", "clean-session");
  Deno.env.set("SPECNAUT_SESSION_RECORD", clean);
  try {
    const onBranch = await gate(root, hook("current-session"));
    assertEquals(onBranch.code, 2);
    assertStringIncludes(onBranch.err, `${SESSION_REASON.atStart}: ${CHECKOUT_REASON.headAhead}`);
    assertEquals(await exists(passFile(root)), false);
    const none = await gate(root, hook("unrecorded-session"));
    assertEquals(none.code, 2);
    assertStringIncludes(none.err, "this session has no session-start record");
    assertEquals((await gate(root, hook("clean-session"))).code, 0);
    assert(await exists(passFile(root)), "a holding checkout leaves the pass");
    assertEquals((await gate(root, hook("current-session"))).code, 2);
    assertEquals(await exists(passFile(root)), false, "a refusal removes the pass");
  } finally {
    Deno.env.delete("SPECNAUT_SESSION_RECORD");
  }
});

Deno.test("a record read that throws is a refusal with exit 2, never a pass", async () => {
  const { root } = await setUp();
  const real = openGate(root);
  const throwing = (): GateDeps => ({
    ...real,
    verify: async () =>
      await verifyCheckout({
        git: await GitObjects.open(root),
        reflog: await FsHeadReflog.open(root),
        walker: new FsScriptTreeWalker(root),
        checkout: new FsTreeWalker(root),
        session: { read: () => Promise.reject(new Deno.errors.FilesystemLoop("ELOOP: lstat")) },
        core: CORE_BUNDLE,
        findHarness,
      }, null),
  });
  await (await FsReviewPass.open(root))!.grant("earlier");
  const run = await gate(root, hook("any-session"), throwing);
  assertEquals(run.code, 2);
  assertStringIncludes(run.err, "the checkout check could not finish: ELOOP: lstat");
  assertEquals(await exists(passFile(root)), false, "a pass left earlier is removed");
});

Deno.test({
  name: "a record folder the gate may not read stops the command with exit 2",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const { root } = await setUp();
    await startSession(root, "startup", "locked-session");
    const folder = join(root, ".git", "specnaut", "session");
    await Deno.chmod(folder, 0o000);
    try {
      const run = await gate(root, hook("locked-session"));
      assertEquals(run.code, 2);
      assertStringIncludes(run.err, "the checkout check could not finish");
    } finally {
      await Deno.chmod(folder, 0o700);
    }
  },
});

Deno.test("a command that starts no review passes untouched, even outside a repository", async () => {
  const dir = await Deno.makeTempDir({ prefix: "gate-none-" });
  try {
    assertEquals(await gate(dir, hook("s", "ls -la")), { code: 0, err: "" });
    assertEquals(await gate(dir, { not: "a hook's input" }), { code: 0, err: "" });
    const run = await gate(dir, hook("s"));
    assertEquals(run.code, 2);
    assertStringIncludes(run.err, "in no git repository");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a gate given no input on stdin refuses", async () => {
  const said: string[] = [];
  const input = () => Promise.resolve(null);
  const code = await runReviewGate({ cwd: ".", input, err: (s) => said.push(s), open: openGate });
  assertEquals(code, 2);
  assertStringIncludes(said.join(""), "reads a PreToolUse hook's input on stdin");
});
