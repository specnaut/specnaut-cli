import { assertEquals, assertThrows } from "@std/assert";
import {
  ClaudeSettingsParseError,
  mergeClaudeSettings,
} from "../../src/domain/claude_settings_merge.ts";

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
  const merged = mergeClaudeSettings(null, BUNDLED, DEST);
  const parsed = JSON.parse(merged);
  assertEquals(parsed.hooks.PreToolUse[0].hooks[0].command, ".claude/hooks/protect-generated.sh");
  assertEquals(
    parsed.hooks.SessionStart[0].hooks[0].command,
    ".claude/hooks/check-backlog-prereqs.sh",
  );
});

Deno.test("mergeClaudeSettings: empty user file is treated as greenfield", () => {
  const merged = mergeClaudeSettings("", BUNDLED, DEST);
  const parsed = JSON.parse(merged);
  assertEquals(Object.keys(parsed.hooks).length, 4);
});

Deno.test("mergeClaudeSettings: user file with no `hooks` key gets all bundled hooks grafted in", () => {
  const userExisting = JSON.stringify({ theme: "dark", attribution: { commit: "x" } });
  const merged = mergeClaudeSettings(userExisting, BUNDLED, DEST);
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
  const merged = mergeClaudeSettings(userExisting, BUNDLED, DEST);
  const parsed = JSON.parse(merged);
  // Specflow's protect-generated hook is already there → not duplicated.
  assertEquals(parsed.hooks.PreToolUse[0].hooks.length, 1);
  assertEquals(parsed.hooks.PreToolUse[0].hooks[0].command, ".claude/hooks/protect-generated.sh");
  // The other 3 events get added because they were absent.
  assertEquals(Object.keys(parsed.hooks).length, 4);
});

Deno.test("mergeClaudeSettings: re-merging the merged output yields byte-identical content", () => {
  const userExisting = JSON.stringify({ theme: "dark" });
  const first = mergeClaudeSettings(userExisting, BUNDLED, DEST);
  const second = mergeClaudeSettings(first, BUNDLED, DEST);
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
  const merged = mergeClaudeSettings(userExisting, BUNDLED, DEST);
  const parsed = JSON.parse(merged);
  assertEquals(parsed.hooks.PreToolUse.length, 2);
  // User's Bash group untouched.
  const userGroup = parsed.hooks.PreToolUse.find((g: { matcher?: string }) => g.matcher === "Bash");
  assertEquals(userGroup.hooks[0].command, "/usr/local/bin/audit-bash.sh");
  // Specflow's Edit|Write group grafted in.
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
  const merged = mergeClaudeSettings(userExisting, BUNDLED, DEST);
  const parsed = JSON.parse(merged);
  // One Edit|Write group with both hooks.
  assertEquals(parsed.hooks.PreToolUse.length, 1);
  assertEquals(parsed.hooks.PreToolUse[0].hooks.length, 2);
  const cmds = parsed.hooks.PreToolUse[0].hooks.map((h: { command: string }) => h.command);
  assertEquals(cmds.includes("/usr/local/bin/lint.sh"), true);
  assertEquals(cmds.includes(".claude/hooks/protect-generated.sh"), true);
});

Deno.test("mergeClaudeSettings: malformed user JSON throws ClaudeSettingsParseError", () => {
  assertThrows(
    () => mergeClaudeSettings("{ this is not json }", BUNDLED, DEST),
    ClaudeSettingsParseError,
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
  const merged = mergeClaudeSettings(userExisting, BUNDLED, DEST);
  const parsed = JSON.parse(merged);
  assertEquals(parsed.theme, "dark");
  assertEquals(parsed.permissions.allow, ["Bash(git *)"]);
  assertEquals(parsed.env.DEBUG, "true");
  assertEquals(parsed.plugins["myteam-plugin"], "git+ssh://...");
  // Hooks were grafted in.
  assertEquals(Object.keys(parsed.hooks).length, 4);
});
