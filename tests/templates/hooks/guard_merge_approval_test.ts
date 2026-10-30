import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  approve,
  HARNESSES,
  makeRepo,
  payload,
  runHook,
  type Sandbox,
  sandbox,
  stampDir,
} from "./hook_sandbox.ts";
import { bash, type Verdict, verdict } from "./guard_merge_fixture.ts";

/**
 * How a gated landing resolves (FR-017, SC-002, spec 048 § 8): through
 * approval_require, for every reason guard-merge gates — a listed script,
 * `gh pr merge`, raw git landing on the base. Without this turn's `merge`
 * from the user it is denied on both harnesses, Claude's ask modes included;
 * with it, Claude asks once more where it can, and everywhere else it lands.
 * Moved out of guard_merge_test.ts, which keeps the table of landing forms.
 */

const LAND = "bash .specnaut/scripts/bash/land-feature.sh";

Deno.test("guard-merge: the refusal names the base and the word to type; the ask, the rule", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { head: "feat" });
    for (const h of HARNESSES) {
      const r = await bash(sb, h, repo, "git push origin main");
      assertEquals(r.code, 2, h);
      assertStringIncludes(r.stderr, "main");
      assertStringIncludes(r.stderr, "`merge`");
    }
    await approve(sb, "claude", repo, "merge");
    const ask = await bash(sb, "claude", repo, "git push origin main");
    assertStringIncludes(
      JSON.parse(ask.stdout).hookSpecificOutput.permissionDecisionReason,
      "merge: manual",
    );
  } finally {
    await sb.cleanup();
  }
});

/**
 * Spec 048 § 8 — approval_require: with no `merge` from the user this turn,
 * denied in every Claude mode, the ask modes included (a click is not the
 * user's word); with one, asked once more where Claude can ask (default,
 * acceptEdits, plan — FR-017), allowed where it cannot.
 */
Deno.test("guard-merge on Claude: denied in every mode without the user's merge, asked once with it", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { head: "feat" });
    const modes = ["default", "acceptEdits", "plan", "bypassPermissions", "auto", "dontAsk", ""];
    const push = (mode: string) =>
      bash(sb, "claude", repo, "git push origin main", { permission_mode: mode });
    for (const mode of modes) {
      const r = await push(mode);
      assertEquals(verdict(r), "deny", `no approval, mode ${JSON.stringify(mode)}: ${r.stderr}`);
    }
    await approve(sb, "claude", repo, "merge");
    for (const mode of modes) {
      const want: Verdict = modes.indexOf(mode) < 3 ? "ask" : "allow";
      const r = await push(mode);
      assertEquals(verdict(r), want, `approved, mode ${JSON.stringify(mode)}: ${r.stderr}`);
    }
  } finally {
    await sb.cleanup();
  }
});

async function writeStamp(sb: Sandbox, repo: string, session: string, stamp: unknown) {
  const dir = await stampDir(sb, repo);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, session), JSON.stringify(stamp));
}

Deno.test("guard-merge on Codex: only this turn's merge approval lets a landing through (SC-002)", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { head: "feat" });
    const p = await payload("codex", "pre_tool_use_bash");
    const session = p.session_id as string;
    const turn = p.turn_id as string;
    const push = (extra: Record<string, unknown> = {}) =>
      bash(sb, "codex", repo, "git push origin main", extra);

    await approve(sb, "codex", repo, "merge");
    assertEquals(verdict(await push()), "allow", "approved this turn");
    // Covers every gated command of its kind in that turn (merge.md merges, then pushes).
    assertEquals(
      verdict(await bash(sb, "codex", repo, "git checkout main && git merge --ff-only feat")),
      "allow",
    );

    assertEquals(
      verdict(await push({ turn_id: "019a2b3c-ffff-7000-8000-000000000001" })),
      "deny",
      "a stamp from a previous turn",
    );

    await approve(sb, "codex", repo, "release it");
    assertEquals(verdict(await push()), "deny", "a stamp of the wrong kind");

    // Control: a well-formed forgery where the guard looks is read, so each one
    // below fails on its content, never on its location.
    await writeStamp(sb, repo, session, { session_id: session, turn_id: turn, kind: "merge" });
    assertEquals(verdict(await push()), "allow", "a stamp writeStamp put where the guard reads");
    await writeStamp(sb, repo, session, { session_id: session, turn_id: "", kind: "merge" });
    assertEquals(verdict(await push({ turn_id: "" })), "deny", "empty turn ids on both sides");

    await writeStamp(sb, repo, session, { session_id: "", turn_id: turn, kind: "merge" });
    assertEquals(verdict(await push()), "deny", "an empty session id in the stamp");

    await writeStamp(sb, repo, session, "not an object");
    assertEquals(verdict(await push()), "deny", "an unreadable stamp");

    await approve(sb, "codex", repo, "merge");
    await runHook(
      sb,
      "approve-on-prompt.sh",
      "codex",
      await payload("codex", "stop", { cwd: repo }),
    );
    assertEquals(verdict(await push()), "deny", "Stop ended the turn");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("guard-merge on Claude bypass: empty ids on both sides never match", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { head: "feat" });
    const session = (await payload("claude", "pre_tool_use_bash")).session_id as string;
    await writeStamp(sb, repo, session, { session_id: "", turn_id: "", kind: "merge" });
    const r = await bash(sb, "claude", repo, "git push origin main", {
      permission_mode: "bypassPermissions",
    });
    assertEquals(verdict(r), "deny");
    const noSession = await bash(sb, "claude", repo, "git push origin main", {
      permission_mode: "bypassPermissions",
      session_id: "",
    });
    assertEquals(verdict(noSession), "deny");
  } finally {
    await sb.cleanup();
  }
});

/**
 * Spec 048 § 8 — one arm for every landing: a listed script, raw git, and a
 * line holding both are denied, not asked, in Claude's default mode with no
 * approval. Before, only the reason decided: a listed script or a raw push
 * went to Claude's prompt, where a click let it through. With the user's
 * `merge`, each is asked exactly once; Codex, which cannot ask, is unchanged.
 */
Deno.test("guard-merge: every landing reason is denied, not asked, without the user's merge", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { head: "feat" });
    const lines = [
      LAND,
      "git push origin main",
      `${LAND} && git push origin main`,
      "gh pr merge 12",
    ];
    for (const h of HARNESSES) {
      for (const line of lines) {
        const r = await bash(sb, h, repo, line);
        assertEquals(verdict(r), "deny", `${h}, no approval: ${JSON.stringify(line)} ${r.stdout}`);
      }
    }
    await approve(sb, "claude", repo, "merge");
    await approve(sb, "codex", repo, "merge");
    for (const line of lines) {
      const ask = await bash(sb, "claude", repo, line);
      assertEquals(verdict(ask), "ask", `claude, approved: ${JSON.stringify(line)} ${ask.stderr}`);
      assertEquals(ask.stdout.trim().split("\n").length, 1, "one ask, never two");
      const codex = await bash(sb, "codex", repo, line);
      assertEquals(verdict(codex), "allow", `codex, approved: ${JSON.stringify(line)}`);
    }
  } finally {
    await sb.cleanup();
  }
});
