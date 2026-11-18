import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { specnautHookFile } from "../../src/domain/hook_settings_merge.ts";
import {
  claudeSettingsNotes,
  mergeClaudeSettings,
} from "../../src/domain/claude_settings_merge.ts";

/**
 * Every hook Specnaut runs with bash is registered through the launcher of `.claude/hooks/`, which
 * finds bash on the PATH the hooks' rule keeps; each used to be registered as `bash "<script>"`,
 * bash looked up on the session's raw PATH. Both spellings are Specnaut's, so an upgrade rewrites
 * the old entry in place rather than leave it beside the new one, still starting the script with
 * whatever `bash` the raw PATH finds first.
 */

/** Each bash hook the bundle registers: its folder, its script, its argument. */
const BASH_HOOKS = [
  [".claude", "review-gate", ""],
  [".claude", "review-lock", ""],
  [".claude", "record-checkout", ""],
  [".specnaut", "protect-generated", " claude"],
  [".specnaut", "guard-dispatch-model", " claude"],
  [".specnaut", "log-subagent", " start"],
  [".specnaut", "log-subagent", " stop"],
] as const;
const script = (folder: string, name: string) => `"$CLAUDE_PROJECT_DIR/${folder}/hooks/${name}.sh"`;
const BEFORE = (folder: string, name: string, args: string) =>
  `bash ${script(folder, name)}${args}`;
const LAUNCHER = `/bin/sh "$CLAUDE_PROJECT_DIR/.claude/hooks/run-hook.sh"`;
const LAUNCHED = (folder: string, name: string, args: string) =>
  `${LAUNCHER} ${script(folder, name)}${args}`;

const BUNDLED = Deno.readTextFileSync(
  new URL("../../templates/harness-specific/claude/settings.json", import.meta.url),
);

type Hook = { command: string };
type Group = { matcher?: string; hooks: Hook[] };

/** Every command of every event, group by group. */
function commands(content: string): string[] {
  const groups = Object.values(JSON.parse(content).hooks as Record<string, Group[]>).flat();
  return groups.flatMap((g) => g.hooks.map((h) => h.command));
}

Deno.test("specnautHookFile: a bash hook, launched or as it was registered before, names its script", () => {
  for (const [folder, name, args] of BASH_HOOKS) {
    assertEquals(specnautHookFile(BEFORE(folder, name, args)), name, BEFORE(folder, name, args));
    assertEquals(
      specnautHookFile(LAUNCHED(folder, name, args)),
      name,
      LAUNCHED(folder, name, args),
    );
  }
});

Deno.test("specnautHookFile: the launcher running another script, or a line around it, is the user's", () => {
  for (
    const command of [
      `${LAUNCHER} ${script(".claude", "my-hook")}`,
      `${LAUNCHER} "$CLAUDE_PROJECT_DIR/scripts/review-gate.sh"`,
      `${LAUNCHED(".claude", "review-gate", "")}; exit 0`,
      `${LAUNCHED(".specnaut", "protect-generated", " claude")} && echo mine`,
      `sh "$CLAUDE_PROJECT_DIR/.claude/hooks/run-hook.sh" ${script(".claude", "review-gate")}`,
      `${LAUNCHED(".claude", "review-lock", "")} --strict`,
      BEFORE(".claude", "my-hook", ""),
      LAUNCHER,
    ]
  ) assertEquals(specnautHookFile(command), null, command);
});

Deno.test("the bundled settings.json launches every hook it runs with bash, each Specnaut's", () => {
  const all = commands(BUNDLED);
  for (const [folder, name, args] of BASH_HOOKS) {
    assertEquals(all.filter((c) => c === LAUNCHED(folder, name, args)).length, 1, name);
  }
  assertEquals(all.filter((c) => /^bash\b/.test(c)), [], "a hook still starts bash from the PATH");
});

Deno.test("an upgrade rewrites each bash hook registered before in place, once", () => {
  const old = (folder: string, name: string, args = "") => ({
    command: BEFORE(folder, name, args),
  });
  const user = JSON.stringify({
    hooks: {
      PreToolUse: [
        { matcher: "Edit|Write", hooks: [old(".specnaut", "protect-generated", " claude")] },
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "mine.sh" }, old(".claude", "review-gate")],
        },
        { matcher: "*", hooks: [old(".claude", "review-lock")] },
        { matcher: "Agent|Task", hooks: [old(".specnaut", "guard-dispatch-model", " claude")] },
      ],
      SubagentStart: [{ hooks: [old(".specnaut", "log-subagent", " start")] }],
      SubagentStop: [{ hooks: [old(".specnaut", "log-subagent", " stop")] }],
      SessionStart: [{ hooks: [old(".claude", "record-checkout")] }],
    },
  });
  const { content } = mergeClaudeSettings(user, BUNDLED, ".claude/settings.json");
  const all = commands(content);
  for (const [folder, name, args] of BASH_HOOKS) {
    assertEquals(all.filter((c) => c.includes(`${name}.sh"${args}`)), [
      LAUNCHED(folder, name, args),
    ]);
  }
  const bash = JSON.parse(content).hooks.PreToolUse.find((g: Group) => g.matcher === "Bash");
  assert(bash.hooks[0].command === "mine.sh", "the user's own entry keeps its place");
  assertEquals(bash.hooks[1].command, LAUNCHED(".claude", "review-gate", ""), "replaced in place");
});

const DEST = ".claude/settings.json";
/** What an upgrade of `user` says about the hook entries it kept, the plugin notes aside. */
const keptNotes = (user: string) =>
  claudeSettingsNotes(user, BUNDLED, DEST).filter((n) => n.includes("kept your hook entry"));

Deno.test("an upgrade keeps a customised bash hook entry beside the launched one, and says so", () => {
  const mine = `${BEFORE(".claude", "review-gate", "")} || true`;
  const user = JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: mine }] }] },
  });
  const { content } = mergeClaudeSettings(user, BUNDLED, DEST);
  const bash = JSON.parse(content).hooks.PreToolUse.find((g: Group) => g.matcher === "Bash");
  assertEquals(
    bash.hooks.map((h: Hook) => h.command),
    [mine, LAUNCHED(".claude", "review-gate", "")],
    "the user's entry is kept, the launched one appended",
  );
  assertEquals(keptNotes(user), [
    `${DEST}: kept your hook entry ${mine} — it runs review-gate.sh, but not through ` +
    "run-hook.sh: it starts bash from the PATH the session inherits, where an entry inside the " +
    "repository can supply it. Specnaut's own entry runs beside it; remove yours, or launch it " +
    "as Specnaut's is",
  ]);
});

Deno.test("no word on an entry the upgrade rewrites, runs no bundled script, or runs one launched", () => {
  const user = JSON.stringify({
    hooks: {
      PreToolUse: [{
        matcher: "Bash",
        hooks: [
          { command: "mine.sh" },
          { command: BEFORE(".claude", "my-review-gate", "") },
          { command: `${LAUNCHED(".claude", "review-lock", "")} --strict` },
          // Specnaut's own, as registered before: the upgrade rewrites it, so there is no word to say.
          { command: BEFORE(".claude", "review-gate", "") },
        ],
      }],
    },
  });
  assertEquals(keptNotes(user), []);
  const fresh = mergeClaudeSettings(null, BUNDLED, DEST).content;
  assertEquals(keptNotes(fresh), [], "a project already up to date");
});

Deno.test("a kept entry naming the script by a Windows path is said too", () => {
  const mine = String.raw`bash .claude\hooks\review-lock.sh`;
  const user = JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "*", hooks: [{ command: mine }] }] },
  });
  assertEquals(keptNotes(user).length, 1, mine);
  assertStringIncludes(keptNotes(user)[0], `kept your hook entry ${mine} — it runs review-lock.sh`);
});
