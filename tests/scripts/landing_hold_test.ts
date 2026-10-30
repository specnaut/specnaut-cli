import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import { git, run, type Sandbox, sandbox } from "./git_sandbox.ts";
import { BRANCH, shipped, state } from "./remove_spec_fixture.ts";
import { bashPath, HOOKS_DIR, payload } from "../templates/hooks/hook_sandbox.ts";
import { verdict } from "../templates/hooks/guard_merge_fixture.ts";

/**
 * Spec 048 — under `merge: manual`, land-feature.sh and remove-spec.sh hold
 * themselves (exit 13) unless this session's `merge` stamp says otherwise, so
 * a spelling the landing hook cannot read is held all the same. The stamp is
 * minted by the installed approve-on-prompt.sh, as a user's prompt mints it.
 */

const SESSION = "3f2c9a1e-7b4d-4e8a-9c21-5d6f0e8b7a10";
const BIN = ".specnaut/scripts/bash";
/** What only the hold prints: the reader's refusal, naming the word to reply. */
const HELD = "specnaut merge-approved: held — merge: manual";

/** The hooks installed and `merge: <mode>` committed on the base, pushed — as a scaffold leaves it. */
async function install(sb: Sandbox, mode: string) {
  await copy(HOOKS_DIR, join(sb.work, ".specnaut", "hooks"));
  await Deno.writeTextFile(join(sb.work, ".specnaut", "workflow.yml"), `merge: ${mode}\n`);
  await git(sb.work, "add", ".specnaut");
  await git(sb.work, "commit", "--quiet", "-m", "chore: hooks and the merge mode");
  await git(sb.work, "push", "--quiet", "origin", "main");
}

async function feature(mode: string) {
  const sb = await sandbox();
  await install(sb, mode);
  await git(sb.work, "switch", "--quiet", "-c", "feature");
  await sb.commit("f", "x\n", "feat(7): a feature");
  return sb;
}

/** Inside a Claude Code session: its id exported, the stamps under the sandbox. */
const session = (sb: Sandbox) => ({
  CLAUDE_CODE_SESSION_ID: SESSION,
  XDG_STATE_HOME: join(sb.root, "state"),
});

/** `bash <BIN>/<script>` from the clone, inside that session. */
const inSession = (sb: Sandbox, script: string, ...args: string[]) =>
  run("bash", [bashPath(`${BIN}/${script}`), ...args], sb.work, session(sb));

/** Pipes a Claude payload into an installed hook, from the clone. */
async function hook(sb: Sandbox, name: string, fixture: string, extra: Record<string, unknown>) {
  const p = JSON.stringify(await payload("claude", fixture, { cwd: sb.work, ...extra }));
  return run(
    "bash",
    ["-c", 'printf %s "$1" | bash "$2" claude', "_", p, `.specnaut/hooks/${name}`],
    sb.work,
    session(sb),
  );
}

/** The user's prompt said `merge`: the stamp the hold reads. */
async function approveMerge(sb: Sandbox) {
  const r = await hook(sb, "approve-on-prompt.sh", "user_prompt_submit", { prompt: "merge" });
  assertEquals(r.code, 0, r.stderr);
}

Deno.test("a renamed copy of land-feature.sh is held by the script itself — the hook never saw it", async () => {
  const sb = await feature("manual");
  try {
    await Deno.copyFile(join(sb.work, BIN, "land-feature.sh"), join(sb.work, BIN, "ship.sh"));
    // Committed: on a clean tree the unheld copy would land, not stop as dirty.
    await git(sb.work, "add", BIN);
    await git(sb.work, "commit", "--quiet", "-m", "chore: a copy");
    const call = `bash ${BIN}/ship.sh`;
    const v = verdict(
      await hook(sb, "guard-merge.sh", "pre_tool_use_bash", { tool_input: { command: call } }),
    );
    assertEquals(v, "allow", "the parser misses this spelling: the script is what holds it");
    const before = await git(sb.remote, "rev-parse", "main");
    const r = await inSession(sb, "ship.sh");
    assertEquals(r.code, 13, r.stderr);
    assertStringIncludes(r.stderr, HELD);
    assertEquals(await git(sb.remote, "rev-parse", "main"), before, "origin's base unchanged");
    assertEquals(await git(sb.work, "symbolic-ref", "--short", "HEAD"), "feature");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("manual with this turn's merge stamp lands; auto with an id lands", async () => {
  for (const mode of ["manual", "auto"]) {
    const sb = await feature(mode);
    try {
      if (mode === "manual") await approveMerge(sb);
      const head = await git(sb.work, "rev-parse", "HEAD");
      const r = await inSession(sb, "land-feature.sh");
      assertEquals(r.code, 0, `${mode}: ${r.stderr}`);
      assertStringIncludes(r.stdout, "LANDED main");
      assertEquals(await git(sb.remote, "rev-parse", "main"), head, mode);
    } finally {
      await sb.cleanup();
    }
  }
});

Deno.test("remove-spec.sh is held under manual, nothing changed, and runs on the merge stamp", async () => {
  const sb = await shipped();
  try {
    await install(sb, "manual");
    const before = await state(sb.work);
    const r = await inSession(sb, "remove-spec.sh", BRANCH);
    assertEquals(r.code, 13, r.stderr);
    assertStringIncludes(r.stderr, HELD);
    assertEquals(await state(sb.work), before, "nothing changed");
    await approveMerge(sb);
    const ok = await inSession(sb, "remove-spec.sh", BRANCH);
    assertEquals(ok.code, 0, ok.stderr);
    assertEquals(await git(sb.work, "ls-files", ".specnaut/specs"), "");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("only the helper's own line allows: a helper that dies silently, or is gone, holds — 13, never 12", async () => {
  const sb = await feature("auto");
  try {
    const helper = join(sb.work, BIN, "merge-hold.sh");
    const real = await Deno.readTextFile(helper);
    // A `set -u` abort under an EXIT trap: bash 3.2 exits 0, printing nothing.
    const mutated = real.replace(/^run\(\) \{/m, "trap ':' EXIT\n: \"$UNSET_BY_DESIGN\"\nrun() {");
    assert(mutated !== real, "the mutation applied");
    await Deno.writeTextFile(helper, mutated);
    await git(sb.work, "commit", "--quiet", "-am", "chore: a helper that dies silently");
    const silent = await inSession(sb, "land-feature.sh");
    assertEquals(silent.code, 13, silent.stderr);
    assert(!silent.stderr.includes("unexpected failure"), "the ERR trap did not turn it into 12");

    await git(sb.work, "rm", "--quiet", helper);
    await git(sb.work, "commit", "--quiet", "-m", "chore: no helper");
    for (const [script, ...args] of [["land-feature.sh"], ["remove-spec.sh", BRANCH]]) {
      const gone = await inSession(sb, script, ...args);
      assertEquals(gone.code, 13, `${script}: ${gone.stderr}`);
      assertStringIncludes(gone.stderr, "specnaut upgrade");
    }
    assertEquals(await git(sb.work, "symbolic-ref", "--short", "HEAD"), "feature");
  } finally {
    await sb.cleanup();
  }
});
