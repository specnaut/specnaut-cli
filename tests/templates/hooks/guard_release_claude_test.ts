import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  approve,
  HOOKS_DIR,
  makeRepo,
  payload,
  pool,
  type Run,
  runHook,
  type Sandbox,
  sandbox,
} from "./hook_sandbox.ts";

/**
 * cli#699 — guard-release runs on Claude Code too. `permissions.ask` matches a
 * command only by the words it starts with, so `gh -R o/r release create v1`
 * and `bash -lc "gh release create v1"` matched no rule and published without
 * the user. The hook reads the line the way the Codex arm does (_command.sh,
 * cmd_pos) and resolves through approval_gate: Claude's own prompt where it can
 * ask, and elsewhere only this turn's `release it`.
 */

type Verdict = "allow" | "ask" | "deny";

/** approval_gate's refusal, worded for the release rule — a crash exits 2 too. */
const DENY =
  /^specnaut guard-release: .+ publishes a release, .+ To let it through, reply `release it` /;

function verdict(r: Run): Verdict | string {
  if (r.code === 2 && DENY.test(r.stderr)) return "deny";
  if (r.code === 0 && r.stdout === "" && r.stderr === "") return "allow";
  if (r.code === 0 && r.stdout !== "") {
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    if (out?.permissionDecision === "ask") {
      if (/publishes a release/.test(out.permissionDecisionReason)) return "ask";
    }
  }
  return `unexpected exit ${r.code}: ${r.stdout} ${r.stderr}`;
}

/** Runs guard-release.sh on a Claude Bash call of `command`, made in `repo`. */
async function claude(
  sb: Sandbox,
  repo: string,
  command: string,
  extra: Record<string, unknown> = {},
): Promise<Run> {
  const p = await payload("claude", "pre_tool_use_bash", {
    cwd: repo,
    tool_input: { command },
    ...extra,
  });
  return runHook(sb, "guard-release.sh", "claude", p);
}

const CASES: ReadonlyArray<[command: string, want: Verdict]> = [
  // the spellings no `permissions.ask` prefix rule matches
  ["gh -R o/r release create v1", "ask"],
  ["gh --repo o/r release create v1", "ask"],
  ["gh --repo=o/r release upload v1 a.tgz", "ask"],
  ["glab -R o/r release create v1", "ask"],
  // one level of shell wrapping
  ['bash -lc "gh release create v1"', "ask"],
  ["sh -c 'gh release edit v1 --draft=false'", "ask"],
  ["bash -c 'gh -R o/r release create v1'", "ask"],
  // what the ask list already held still asks
  ["gh release create v1", "ask"],
  ["bash .claude/skills/ship/scripts/tag.sh --bump minor", "ask"],
  ["git push origin v1.0.0", "ask"],
  // nothing published: silent
  ["gh -R o/r release view v1", "allow"],
  ['bash -lc "gh release list"', "allow"],
  ["tag.sh --no-push", "allow"],
  ["git push origin feat", "allow"],
  ["git status", "allow"],
];

Deno.test("guard-release on Claude: every listed command asks, behind -R/--repo and one sh -c", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto", head: "feat" });
    const runs = await pool(CASES, ([command]) => claude(sb, repo, command));
    const wrong = CASES.flatMap(([command, want], i) => {
      const got = verdict(runs[i]);
      return got === want ? [] : [`${JSON.stringify(command)}: want ${want}, got ${got}`];
    });
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});

/**
 * approval_gate against permission_mode, as guard-merge reads it: where
 * Claude's prompt reaches the user (default, acceptEdits, plan) it asks;
 * where it cannot (bypassPermissions, auto, dontAsk, an unknown mode) only
 * this turn's `release it` lets the release through.
 */
Deno.test("guard-release on Claude: asks where Claude can ask, elsewhere needs this turn's `release it`", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto", head: "feat" });
    const modes = ["default", "acceptEdits", "plan", "bypassPermissions", "auto", "dontAsk", ""];
    const publish = (mode: string) =>
      claude(sb, repo, "gh -R o/r release create v1", { permission_mode: mode });
    for (const [i, mode] of modes.entries()) {
      const want: Verdict = i < 3 ? "ask" : "deny";
      assertEquals(verdict(await publish(mode)), want, `no approval, mode ${JSON.stringify(mode)}`);
    }
    const refused = await publish("bypassPermissions");
    assertStringIncludes(refused.stderr, "`release it` (or `/ship release`)");

    await approve(sb, "claude", repo, "release it");
    for (const [i, mode] of modes.entries()) {
      const want: Verdict = i < 3 ? "ask" : "allow";
      assertEquals(verdict(await publish(mode)), want, `approved, mode ${JSON.stringify(mode)}`);
    }
    await approve(sb, "claude", repo, "merge");
    assertEquals(verdict(await publish("bypassPermissions")), "deny", "a merge is not a release");
  } finally {
    await sb.cleanup();
  }
});

/** Without a registration the rule above never runs: Claude reads only settings.json. */
Deno.test("guard-release is registered for Claude's Bash calls in the scaffolded settings.json", async () => {
  const settings = JSON.parse(
    await Deno.readTextFile(join(HOOKS_DIR, "..", "..", "claude", "settings.json")),
  );
  const bash = settings.hooks.PreToolUse.filter((g: { matcher?: string }) => g.matcher === "Bash")
    .flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));
  assertEquals(
    bash.filter((c: string) =>
      c === 'bash "$CLAUDE_PROJECT_DIR/.specnaut/hooks/guard-release.sh" claude'
    ),
    ['bash "$CLAUDE_PROJECT_DIR/.specnaut/hooks/guard-release.sh" claude'],
  );
  // the prefix rules stay: they are the prompt where the hook cannot read a line
  assertEquals(settings.permissions.ask.includes("Bash(gh release create *)"), true);
});
