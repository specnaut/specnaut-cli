import { assertEquals, assertThrows } from "@std/assert";
import { mergeClaudeSettings } from "../../src/domain/claude_settings_merge.ts";
import { JsonMergeParseError } from "../../src/domain/json_merge.ts";

const BUNDLED = JSON.stringify(
  {
    "$schema": "https://json.schemastore.org/claude-code-settings.json",
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit|Write",
          hooks: [{ type: "command", command: ".claude/hooks/protect-generated.sh", timeout: 5 }],
        },
      ],
      SubagentStart: [
        {
          hooks: [{ type: "command", command: ".claude/hooks/log-subagent.sh start", timeout: 5 }],
        },
      ],
      SubagentStop: [
        {
          hooks: [{ type: "command", command: ".claude/hooks/log-subagent.sh stop", timeout: 5 }],
        },
      ],
      SessionStart: [
        {
          hooks: [{
            type: "command",
            command: ".claude/hooks/check-backlog-prereqs.sh",
            timeout: 10,
          }],
        },
      ],
    },
  },
  null,
  2,
);

const DEST = ".claude/settings.json";

Deno.test("mergeClaudeSettings: greenfield (no existing file) writes the bundle verbatim", () => {
  const merged = mergeClaudeSettings(null, BUNDLED, DEST).content;
  const parsed = JSON.parse(merged);
  assertEquals(parsed.hooks.PreToolUse[0].hooks[0].command, ".claude/hooks/protect-generated.sh");
  assertEquals(
    parsed.hooks.SessionStart[0].hooks[0].command,
    ".claude/hooks/check-backlog-prereqs.sh",
  );
});

Deno.test("mergeClaudeSettings: empty user file is treated as greenfield", () => {
  const merged = mergeClaudeSettings("", BUNDLED, DEST).content;
  const parsed = JSON.parse(merged);
  assertEquals(Object.keys(parsed.hooks).length, 4);
});

Deno.test("mergeClaudeSettings: user file with no `hooks` key gets all bundled hooks grafted in", () => {
  const userExisting = JSON.stringify({ theme: "dark", attribution: { commit: "x" } });
  const merged = mergeClaudeSettings(userExisting, BUNDLED, DEST).content;
  const parsed = JSON.parse(merged);
  assertEquals(parsed.theme, "dark");
  assertEquals(parsed.attribution.commit, "x");
  assertEquals(parsed.hooks.PreToolUse[0].hooks[0].command, ".claude/hooks/protect-generated.sh");
  assertEquals(
    parsed.hooks.SubagentStart[0].hooks[0].command,
    ".claude/hooks/log-subagent.sh start",
  );
});

Deno.test("mergeClaudeSettings: user hook with same command path is NOT duplicated (idempotent)", () => {
  const userExisting = JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit|Write",
          hooks: [
            { type: "command", command: ".claude/hooks/protect-generated.sh", timeout: 5 },
          ],
        },
      ],
    },
  });
  const merged = mergeClaudeSettings(userExisting, BUNDLED, DEST).content;
  const parsed = JSON.parse(merged);
  // Specnaut's protect-generated hook is already there → not duplicated.
  assertEquals(parsed.hooks.PreToolUse[0].hooks.length, 1);
  assertEquals(parsed.hooks.PreToolUse[0].hooks[0].command, ".claude/hooks/protect-generated.sh");
  // The other 3 events get added because they were absent.
  assertEquals(Object.keys(parsed.hooks).length, 4);
});

Deno.test("mergeClaudeSettings: re-merging the merged output yields byte-identical content", () => {
  const userExisting = JSON.stringify({ theme: "dark" });
  const first = mergeClaudeSettings(userExisting, BUNDLED, DEST).content;
  const second = mergeClaudeSettings(first, BUNDLED, DEST).content;
  assertEquals(first, second);
});

Deno.test("mergeClaudeSettings: user matcher group with different matcher coexists with bundled group", () => {
  const userExisting = JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "/usr/local/bin/audit-bash.sh" }],
        },
      ],
    },
  });
  const merged = mergeClaudeSettings(userExisting, BUNDLED, DEST).content;
  const parsed = JSON.parse(merged);
  assertEquals(parsed.hooks.PreToolUse.length, 2);
  // User's Bash group untouched.
  const userGroup = parsed.hooks.PreToolUse.find((g: { matcher?: string }) => g.matcher === "Bash");
  assertEquals(userGroup.hooks[0].command, "/usr/local/bin/audit-bash.sh");
  // Specnaut's Edit|Write group grafted in.
  const sfGroup = parsed.hooks.PreToolUse.find(
    (g: { matcher?: string }) => g.matcher === "Edit|Write",
  );
  assertEquals(sfGroup.hooks[0].command, ".claude/hooks/protect-generated.sh");
});

Deno.test("mergeClaudeSettings: user matcher group with same matcher gets bundled hook appended", () => {
  const userExisting = JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit|Write",
          hooks: [{ type: "command", command: "/usr/local/bin/lint.sh" }],
        },
      ],
    },
  });
  const merged = mergeClaudeSettings(userExisting, BUNDLED, DEST).content;
  const parsed = JSON.parse(merged);
  // One Edit|Write group with both hooks.
  assertEquals(parsed.hooks.PreToolUse.length, 1);
  assertEquals(parsed.hooks.PreToolUse[0].hooks.length, 2);
  const cmds = parsed.hooks.PreToolUse[0].hooks.map((h: { command: string }) => h.command);
  assertEquals(cmds.includes("/usr/local/bin/lint.sh"), true);
  assertEquals(cmds.includes(".claude/hooks/protect-generated.sh"), true);
});

Deno.test("mergeClaudeSettings: malformed user JSON throws JsonMergeParseError", () => {
  assertThrows(
    () => mergeClaudeSettings("{ this is not json }", BUNDLED, DEST),
    JsonMergeParseError,
    DEST,
  );
});

Deno.test("mergeClaudeSettings: preserves unrelated top-level keys verbatim", () => {
  const userExisting = JSON.stringify({
    theme: "dark",
    permissions: { allow: ["Bash(git *)"] },
    env: { DEBUG: "true" },
    plugins: { "myteam-plugin": "git+ssh://..." },
    hooks: {},
  });
  const merged = mergeClaudeSettings(userExisting, BUNDLED, DEST).content;
  const parsed = JSON.parse(merged);
  assertEquals(parsed.theme, "dark");
  assertEquals(parsed.permissions.allow, ["Bash(git *)"]);
  assertEquals(parsed.env.DEBUG, "true");
  assertEquals(parsed.plugins["myteam-plugin"], "git+ssh://...");
  // Hooks were grafted in.
  assertEquals(Object.keys(parsed.hooks).length, 4);
});

// ---------------------------------------------------------------- #610
//
// Publishing a release is irreversible wherever a workflow listens for it. A
// project that adds a broad `Bash(gh release *)` allow to make `/ship` run
// smoothly also pre-authorises `gh release edit <tag> --draft=false` — a
// publish with no prompt. Specnaut ships `permissions.ask` rules for the
// publish-capable commands; Claude Code evaluates `ask` before `allow`, so they
// hold against any broader allow. The merge must carry them into a
// settings.json that already exists, without touching what the user wrote.

const SHIPPED = Deno.readTextFileSync(
  new URL("../../templates/harness-specific/claude/settings.json", import.meta.url),
);
// The script rules exist because `/ship` never types `gh release create` or
// `git push` itself: the scripts do (#682). The last four complete
// release-commands.txt, the Codex guard's list (spec 036, F4); `gh release
// new` is `gh release create` under its alias (cli#711).
const PUBLISH_ASK = [
  "Bash(gh release create *)",
  "Bash(gh release edit *--draft*)",
  "Bash(gh run rerun *)",
  "Bash(*release/tag.sh*)",
  "Bash(*release/release-github.sh*)",
  "Bash(*release/release-gitlab.sh*)",
  "Bash(gh release edit *)",
  "Bash(gh release upload *)",
  "Bash(glab release create *)",
  "Bash(gh release new *)",
];

Deno.test("claude settings: the shipped file asks for no release and registers no approval hook", () => {
  const shipped = JSON.parse(SHIPPED);
  assertEquals(Object.keys(shipped.permissions), ["deny"]);
  for (
    const retired of ["guard-merge", "guard-release", "protect-constitution", "approve-on-prompt"]
  ) {
    assertEquals(SHIPPED.includes(retired), false, retired);
  }
});

Deno.test("mergeClaudeSettings: the retired ask rules leave, and the user's stay", () => {
  const existing = JSON.stringify({
    permissions: { allow: ["Bash(gh release *)"], ask: ["Bash(git push *)", ...PUBLISH_ASK] },
  });
  const merged = JSON.parse(mergeClaudeSettings(existing, SHIPPED, DEST).content);
  assertEquals(merged.permissions.allow, ["Bash(gh release *)"], "the user's allow is theirs");
  assertEquals(merged.permissions.ask, ["Bash(git push *)"]);
});

Deno.test("mergeClaudeSettings: retired ask rules leave, and only the shipped deny remains", () => {
  const once = mergeClaudeSettings(
    JSON.stringify({ theme: "dark", permissions: { ask: PUBLISH_ASK } }),
    SHIPPED,
    DEST,
  ).content;
  assertEquals(JSON.parse(once).permissions, { deny: JSON.parse(SHIPPED).permissions.deny });
  assertEquals(mergeClaudeSettings(once, SHIPPED, DEST).changed, false, "a re-merge is a no-op");
});

Deno.test("mergeClaudeSettings: the approval hooks leave, the user's hooks stay", () => {
  const entry = (script: string) => ({
    type: "command",
    command: `bash "$CLAUDE_PROJECT_DIR/.specnaut/hooks/${script}.sh" claude`,
  });
  const merged = JSON.parse(
    mergeClaudeSettings(
      JSON.stringify({
        hooks: {
          PreToolUse: [{
            matcher: "Bash",
            hooks: [
              entry("guard-merge"),
              entry("guard-release"),
              entry("protect-constitution"),
              { type: "command", command: "./my-check.sh" },
            ],
          }],
          UserPromptSubmit: [{ hooks: [entry("approve-on-prompt")] }],
          Stop: [{ hooks: [entry("approve-on-prompt")] }],
        },
      }),
      SHIPPED,
      DEST,
    ).content,
  );
  type Group = { matcher?: string; hooks: { command: string }[] };
  const commands = (groups: Group[]) =>
    groups.find((g) => g.matcher === "Bash")?.hooks.map((h) => h.command) ?? [];
  // The Bash group keeps the user's hook and gains the ones Specnaut ships there;
  // the retired approval hooks are the only ones that leave.
  const shippedBash = commands(JSON.parse(SHIPPED).hooks.PreToolUse);
  assertEquals(commands(merged.hooks.PreToolUse), ["./my-check.sh", ...shippedBash]);
  assertEquals(merged.hooks.UserPromptSubmit, undefined);
  assertEquals(merged.hooks.Stop, undefined);
});
