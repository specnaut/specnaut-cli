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
  // Specnaut's protect-generated hook is already there → not duplicated.
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
const PUBLISH_ASK = [
  "Bash(gh release create *)",
  "Bash(gh release edit *--draft*)",
  "Bash(gh run rerun *)",
];

Deno.test("claude settings: the shipped file asks before every publish-capable command (#610)", () => {
  const ask: string[] = JSON.parse(SHIPPED).permissions?.ask ?? [];
  for (const rule of PUBLISH_ASK) {
    assertEquals(ask.includes(rule), true, `shipped settings.json lacks ask rule ${rule}`);
  }
  // A prompt, never a prohibition — and never a bare pre-authorisation.
  const perms = JSON.parse(SHIPPED).permissions ?? {};
  assertEquals(perms.deny, undefined);
  assertEquals((perms.allow ?? []).some((r: string) => r.startsWith("Bash(gh release")), false);
});

Deno.test("mergeClaudeSettings: ask rules reach an existing settings.json beside a broad allow (#610)", () => {
  const existing = JSON.stringify({
    permissions: { allow: ["Bash(gh release *)"], ask: ["Bash(git push *)"] },
  });
  const merged = JSON.parse(mergeClaudeSettings(existing, SHIPPED, DEST));
  assertEquals(merged.permissions.allow, ["Bash(gh release *)"], "the user's allow is theirs");
  assertEquals(merged.permissions.ask, ["Bash(git push *)", ...PUBLISH_ASK]);
});

Deno.test("mergeClaudeSettings: ask rules are not duplicated on re-merge (#610)", () => {
  const once = mergeClaudeSettings(JSON.stringify({ theme: "dark" }), SHIPPED, DEST);
  const twice = mergeClaudeSettings(once, SHIPPED, DEST);
  assertEquals(twice, once);
  assertEquals(JSON.parse(twice).permissions.ask, PUBLISH_ASK);
});

// ── Plugin declarations (#642) ─────────────────────────────────────────────
// The shipped settings declare Specnaut's marketplace and enable the cockpit
// mod, so Claude Code offers both when a person trusts the project. A key the
// user already has is theirs: `false` declines the cockpit for good.

const COCKPIT = "specnaut-cockpit@specnaut-marketplace";

Deno.test("claude settings: the shipped file declares the marketplace and enables the cockpit (#642)", () => {
  const shipped = JSON.parse(SHIPPED);
  assertEquals(shipped.extraKnownMarketplaces?.["specnaut-marketplace"]?.source, {
    source: "github",
    repo: "specnaut/specnaut-marketplace",
  });
  assertEquals(shipped.enabledPlugins?.[COCKPIT], true);
});

Deno.test("mergeClaudeSettings: an existing project gains the marketplace and the cockpit (#642)", () => {
  const existing = JSON.stringify({
    enabledPlugins: { "other@elsewhere": true },
    extraKnownMarketplaces: { elsewhere: { source: { source: "github", repo: "o/r" } } },
  });
  const merged = JSON.parse(mergeClaudeSettings(existing, SHIPPED, DEST));
  assertEquals(merged.enabledPlugins, { "other@elsewhere": true, [COCKPIT]: true });
  assertEquals(Object.keys(merged.extraKnownMarketplaces), ["elsewhere", "specnaut-marketplace"]);
});

Deno.test("mergeClaudeSettings: a project's `false` for the cockpit survives every upgrade (#642)", () => {
  const existing = JSON.stringify({ enabledPlugins: { [COCKPIT]: false } });
  const once = mergeClaudeSettings(existing, SHIPPED, DEST);
  const twice = mergeClaudeSettings(once, SHIPPED, DEST);
  assertEquals(JSON.parse(twice).enabledPlugins[COCKPIT], false);
  assertEquals(twice, once);
});

Deno.test("mergeClaudeSettings: a marketplace the user re-pointed is left as they set it (#642)", () => {
  const mine = { source: { source: "github", repo: "my-fork/specnaut-marketplace" } };
  const existing = JSON.stringify({ extraKnownMarketplaces: { "specnaut-marketplace": mine } });
  const merged = JSON.parse(mergeClaudeSettings(existing, SHIPPED, DEST));
  assertEquals(merged.extraKnownMarketplaces["specnaut-marketplace"], mine);
});
