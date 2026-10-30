import { assertEquals, assertThrows } from "@std/assert";
import { mergeCodexHooks, specnautHookFile } from "../../src/domain/hook_settings_merge.ts";
import { JsonMergeParseError } from "../../src/domain/json_merge.ts";
import { codexHookCommand } from "../../src/domain/hook_command.ts";
import { mergeClaudeSettings } from "../../src/domain/claude_settings_merge.ts";

/**
 * Which hook entries in a user's settings are Specnaut's (plan § 5): an entry
 * whose command is EXACTLY one Specnaut registers — the Claude shape, the Codex
 * shape (any pinned hash), or one of the two scripts Specnaut retired from
 * `.claude/hooks/`. The bundled entry for that file replaces it in place, so a
 * hook that moves — or whose pinned command changes — is rewritten rather than
 * appended beside a stale copy that points nowhere. A command that merely
 * MENTIONS a Specnaut script is the user's: replacing it would delete their
 * hook, with no backup.
 */

const DEST = ".claude/settings.json";

type Hook = { type: string; command: string; timeout?: number };
type Group = { matcher?: string; hooks: Hook[] };

const hook = (command: string): Hook => ({ type: "command", command, timeout: 5 });
const settings = (hooks: Record<string, Group[]>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ...extra, hooks }, null, 2);
const commands = (content: string, event: string, at = 0): string[] =>
  JSON.parse(content).hooks[event][at].hooks.map((h: Hook) => h.command);

/** A Claude registration, spelled as `templates/harness-specific/claude/settings.json` spells it. */
const claude = (script: string, args = "") =>
  `bash "$CLAUDE_PROJECT_DIR/.specnaut/hooks/${script}.sh"${args === "" ? "" : ` ${args}`}`;
const codex = (script: string, hash: string, args = "codex", onChanged: 0 | 2 = 2) =>
  codexHookCommand({ script: `${script}.sh`, args, onChanged }, hash.repeat(64 / hash.length));

const NEW_PROTECT = claude("protect-generated", "claude");
const BUNDLED = settings({
  PreToolUse: [{ matcher: "Edit|Write", hooks: [hook(NEW_PROTECT)] }],
  SubagentStart: [{ hooks: [hook(claude("log-subagent", "start"))] }],
  SubagentStop: [{ hooks: [hook(claude("log-subagent", "stop"))] }],
  SessionStart: [{ hooks: [hook(".claude/hooks/check-backlog-prereqs.sh")] }],
});

Deno.test("specnautHookFile: each exact shape Specnaut registers, or a retired one, names its script", () => {
  for (
    const [command, script] of [
      [claude("guard-merge", "claude"), "guard-merge"],
      [claude("protect-generated"), "protect-generated"],
      [codex("guard-release", "ab"), "guard-release"],
      [codex("log-subagent", "0", "start", 0), "log-subagent"],
      [codex("my_new-guard", "f", ""), "my_new-guard"],
      [".claude/hooks/protect-generated.sh", "protect-generated"],
      [".claude/hooks/log-subagent.sh start", "log-subagent"],
      [".claude/hooks/log-subagent.sh stop", "log-subagent"],
    ]
  ) assertEquals(specnautHookFile(command), script, command);
});

Deno.test("specnautHookFile: a command that only mentions a Specnaut script is the user's", () => {
  for (
    const command of [
      `mycheck.sh && ${claude("guard-merge", "claude")}`,
      `${claude("guard-merge", "claude")} && notify.sh`,
      `${claude("guard-merge", "claude")}; exit 0`,
      ".specnaut/hooks/guard-merge.sh claude",
      '"$(git rev-parse --show-toplevel)/.specnaut/hooks/guard-release.sh" codex',
      "bash .specnaut/hooks/approve-on-prompt.sh",
      `sh -c '${claude("guard-merge")}'`,
      `${codex("guard-merge", "ab")}; echo mine`,
      `mycheck.sh; ${codex("guard-merge", "ab")}`,
      codex("guard-merge", "AB"),
      codex("guard-merge", "a").replace("exit 2", "exit 1"),
      ".claude/hooks/protect-generated.sh --strict",
      "./wrap.sh .claude/hooks/log-subagent.sh start",
      ".claude/hooks/log-subagent.sh begin",
    ]
  ) assertEquals(specnautHookFile(command), null, command);
});

Deno.test("specnautHookFile: the user's own scripts, and Specnaut scripts that did not move, are not", () => {
  for (
    const command of [
      ".claude/hooks/check-backlog-prereqs.sh",
      ".claude/hooks/my-protect.sh",
      "/usr/local/bin/lint.sh",
      "acme.specnaut/hooks/guard-merge.sh",
      ".specnaut/hooks/guard-merge.shell",
      "echo .specnaut/hooks/",
      claude("guard-merge").replace("bash ", "zsh "),
    ]
  ) assertEquals(specnautHookFile(command), null, command);
});

Deno.test("specnautHookFile: every Specnaut command the bundled Claude settings.json registers is recognised", async () => {
  const bundled = JSON.parse(
    await Deno.readTextFile(
      new URL("../../templates/harness-specific/claude/settings.json", import.meta.url),
    ),
  );
  const ours = Object.values(bundled.hooks as Record<string, Group[]>)
    .flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)))
    .filter((c) => c.includes(".specnaut/hooks/"));
  assertEquals(ours.length > 0, true, "the bundle registers .specnaut/hooks scripts");
  for (const command of ours) {
    assertEquals(specnautHookFile(command), /hooks\/([\w-]+)\.sh/.exec(command)?.[1], command);
  }
});

Deno.test("hook splice: a user wrapper that mentions a Specnaut script is kept verbatim", () => {
  const guard = claude("guard-merge", "claude");
  const wrapper = { ...hook(`mycheck.sh && ${guard}`), timeout: 30 };
  const bundled = settings({ PreToolUse: [{ matcher: "Bash", hooks: [hook(guard)] }] });
  const user = settings({ PreToolUse: [{ matcher: "Bash", hooks: [wrapper] }] });
  const { content } = mergeClaudeSettings(user, bundled, DEST);
  assertEquals(JSON.parse(content).hooks.PreToolUse, [
    { matcher: "Bash", hooks: [wrapper, hook(guard)] },
  ]);
  // The same holds on Codex, where the bundled command pins a hash.
  const ours = codex("guard-merge", "e");
  const codexWrapper = hook(`mycheck.sh && ${ours}`);
  const merged = mergeCodexHooks(
    settings({ PreToolUse: [{ matcher: "Bash", hooks: [codexWrapper] }] }),
    settings({ PreToolUse: [{ matcher: "Bash", hooks: [hook(ours)] }] }),
    ".codex/hooks.json",
  );
  assertEquals(commands(merged.content, "PreToolUse"), [codexWrapper.command, ours]);
});

Deno.test("hook splice: Specnaut's entry is replaced in place, the user's neighbours keep their order", () => {
  const user = settings({
    PreToolUse: [{
      matcher: "Edit|Write",
      hooks: [
        hook("/usr/local/bin/lint.sh"),
        hook(claude("protect-generated")),
        hook("/usr/local/bin/fmt.sh"),
      ],
    }],
  });
  const { content } = mergeClaudeSettings(user, BUNDLED, DEST);
  assertEquals(commands(content, "PreToolUse"), [
    "/usr/local/bin/lint.sh",
    NEW_PROTECT,
    "/usr/local/bin/fmt.sh",
  ]);
});

Deno.test("hook splice: a retired .claude/hooks path is rewritten to its new home, not duplicated", () => {
  const user = settings({
    PreToolUse: [{ matcher: "Edit|Write", hooks: [hook(".claude/hooks/protect-generated.sh")] }],
    SubagentStart: [{ hooks: [hook(".claude/hooks/log-subagent.sh start")] }],
    SubagentStop: [{ hooks: [hook(".claude/hooks/log-subagent.sh stop")] }],
  });
  const { content } = mergeClaudeSettings(user, BUNDLED, DEST);
  assertEquals(commands(content, "PreToolUse"), [NEW_PROTECT]);
  assertEquals(commands(content, "SubagentStart"), [claude("log-subagent", "start")]);
  assertEquals(commands(content, "SubagentStop"), [claude("log-subagent", "stop")]);
});

Deno.test("hook splice: every other entry is untouched — other matchers, other scripts, other fields", () => {
  const userGroups: Record<string, Group[]> = {
    PreToolUse: [
      { matcher: "Bash", hooks: [hook(".claude/hooks/my-protect.sh")] },
      { matcher: "Edit|Write", hooks: [{ ...hook("/usr/local/bin/lint.sh"), timeout: 30 }] },
    ],
    SessionStart: [{ hooks: [{ ...hook(".claude/hooks/check-backlog-prereqs.sh"), timeout: 99 }] }],
  };
  const { content } = mergeClaudeSettings(settings(userGroups), BUNDLED, DEST);
  const merged = JSON.parse(content).hooks;
  assertEquals(merged.PreToolUse[0], userGroups.PreToolUse[0]);
  assertEquals(merged.PreToolUse[1].hooks, [userGroups.PreToolUse[1].hooks[0], hook(NEW_PROTECT)]);
  // A bundled hook that is not a `.specnaut/hooks/` script keeps the old rule:
  // the user's copy, with their timeout, is already there and wins.
  assertEquals(merged.SessionStart, userGroups.SessionStart);
});

Deno.test("hook splice: duplicates of one Specnaut script collapse to the bundled entry", () => {
  const user = settings({
    PreToolUse: [
      { matcher: "Edit", hooks: [hook(".claude/hooks/protect-generated.sh")] },
      {
        matcher: "Edit|Write",
        hooks: [
          hook(claude("protect-generated")),
          hook("/usr/local/bin/lint.sh"),
          hook(claude("protect-generated", "claude")),
        ],
      },
    ],
  });
  const { content } = mergeClaudeSettings(user, BUNDLED, DEST);
  const groups = JSON.parse(content).hooks.PreToolUse as Group[];
  // The `Edit` group held nothing but the stale copy, so it goes with it.
  assertEquals(groups.map((g) => g.matcher), ["Edit|Write"]);
  assertEquals(commands(content, "PreToolUse"), [NEW_PROTECT, "/usr/local/bin/lint.sh"]);
});

Deno.test("hook splice: a re-run changes nothing and says so", () => {
  const user = settings({ PreToolUse: [{ matcher: "Edit|Write", hooks: [hook("/bin/x")] }] });
  const first = mergeClaudeSettings(user, BUNDLED, DEST);
  assertEquals(first.changed, true);
  const second = mergeClaudeSettings(first.content, BUNDLED, DEST);
  assertEquals(second, { content: first.content, changed: false });
});

Deno.test("hook splice: a greenfield write is a change", () => {
  assertEquals(mergeClaudeSettings(null, BUNDLED, DEST).changed, true);
  assertEquals(mergeCodexHooks(null, BUNDLED, ".codex/hooks.json").changed, true);
});

// ---------------------------------------------------------------- codex-hooks

const CODEX_DEST = ".codex/hooks.json";
const CODEX_NEW = codex("guard-merge", "2b1f");
const CODEX_STOP = codex("approve-on-prompt", "2b1f", "codex", 0);
const CODEX_BUNDLED = JSON.stringify({
  hooks: {
    PreToolUse: [{ matcher: "Bash", hooks: [hook(CODEX_NEW)] }],
    Stop: [{ hooks: [hook(CODEX_STOP)] }],
  },
  // Never carried by this flavor: `.codex/hooks.json` holds hooks and nothing else of ours.
  permissions: { ask: ["Bash(gh release create *)"] },
  enabledPlugins: { "acme@acme-marketplace": true },
});

Deno.test("codex-hooks: splices hooks into the user's file and carries none of the settings keys", () => {
  const user = JSON.stringify({
    hooks: {
      PreToolUse: [{
        matcher: "Bash",
        hooks: [
          hook("/usr/local/bin/audit.sh"),
          hook(codex("guard-merge", "0")),
          hook("/usr/local/bin/after.sh"),
        ],
      }],
    },
    note: "the user's",
  });
  const { content, changed } = mergeCodexHooks(user, CODEX_BUNDLED, CODEX_DEST);
  const merged = JSON.parse(content);
  assertEquals(changed, true);
  assertEquals(Object.keys(merged), ["hooks", "note"]);
  // The old-hash command is Specnaut's: replaced in place, between the user's two.
  assertEquals(commands(content, "PreToolUse"), [
    "/usr/local/bin/audit.sh",
    CODEX_NEW,
    "/usr/local/bin/after.sh",
  ]);
  assertEquals(commands(content, "Stop"), [CODEX_STOP]);
  assertEquals(mergeCodexHooks(content, CODEX_BUNDLED, CODEX_DEST).changed, false);
});

/**
 * The command 7.3 registered, its root walk keyed on `-d` (cli#700 changed it
 * to `-e || -L`), verbatim from that release's `.codex/hooks.json`. Not
 * recognised, it would be the user's: kept beside the new one, its pinned hash
 * stale, it would refuse every Bash call after the upgrade.
 */
const CODEX_7_3 =
  `r=$PWD; while [ -n "$r" ] && [ ! -d "$r/.specnaut/hooks" ]; do r=\${r%/*}; done; [ "$( (sha256sum 2>/dev/null || shasum -a 256) < "$r/.specnaut/hooks/SHA256SUMS" 2>/dev/null | cut -c1-64)" = "5f1a2aabce6f1fab434be1e3233815e5065e45b0363395ad6371fea0b3adad18" ] && (cd "$r/.specnaut/hooks" && (sha256sum -c --status SHA256SUMS 2>/dev/null || shasum -a 256 -c --status SHA256SUMS)) && exec bash "$r/.specnaut/hooks/guard-merge.sh" codex; echo "specnaut: .specnaut/hooks changed since it was trusted — run specnaut upgrade, then /hooks" >&2; exit 2`;

Deno.test("codex-hooks: the command 7.3 registered is Specnaut's, and the upgrade replaces it", () => {
  assertEquals(specnautHookFile(CODEX_7_3), "guard-merge");
  const user = JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [hook(CODEX_7_3)] }] },
  });
  const { content } = mergeCodexHooks(user, CODEX_BUNDLED, CODEX_DEST);
  assertEquals(commands(content, "PreToolUse"), [CODEX_NEW]);
});

Deno.test("codex-hooks: malformed user JSON names the file", () => {
  assertThrows(
    () => mergeCodexHooks("{ nope", CODEX_BUNDLED, CODEX_DEST),
    JsonMergeParseError,
    CODEX_DEST,
  );
});
