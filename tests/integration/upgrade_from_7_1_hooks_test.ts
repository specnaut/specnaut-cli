import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, isAbsolute, join } from "@std/path";
import { lockText, plant, sha256 } from "./_lock_fixture.ts";

/**
 * The hook move, end to end (FR-014, SC-003): a project a 7.1.0 release left —
 * `protect-generated.sh` and `log-subagent.sh` under `.claude/hooks/`, the
 * `settings.json` registering them there, no `.specnaut/hooks/` — upgraded by
 * the real CLI on the real filesystem.
 *
 * The domain tests prove the splice and the orphan decisions one at a time;
 * this proves that together they leave a project whose every registered hook
 * runs a file that exists, each once.
 */

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

async function runSpecnaut(args: string[], cwd: string, home: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    env: { HOME: home },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { code, out: d.decode(stdout) + d.decode(stderr) };
}

const OLD_PROTECT = ".claude/hooks/protect-generated.sh";
const OLD_LOG = ".claude/hooks/log-subagent.sh";
const RETIRED = ".specnaut/hooks/old-guard.sh";
const MINE = ".claude/hooks/my-check.sh";
const SHIPPED = "#!/usr/bin/env bash\n# as an older release shipped it\nexit 0\n";
const EDITED = `${SHIPPED}# my own tweak\n`;

const hook = (command: string, timeout = 5) => ({ type: "command", command, timeout });

/**
 * The `hooks` block of `git show v7.1.0:templates/harness-specific/claude/settings.json`,
 * verbatim, plus one hook the user added beside Specnaut's in the shared
 * `Edit|Write` group — the group the old `protect-generated.sh` entry leaves.
 */
const V7_1_SETTINGS = {
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  hooks: {
    PreToolUse: [{
      matcher: "Edit|Write",
      hooks: [hook(".claude/hooks/protect-generated.sh"), hook(MINE)],
    }],
    SubagentStart: [{ hooks: [hook(".claude/hooks/log-subagent.sh start")] }],
    SubagentStop: [{ hooks: [hook(".claude/hooks/log-subagent.sh stop")] }],
    SessionStart: [{ hooks: [hook(".claude/hooks/check-backlog-prereqs.sh", 10)] }],
  },
};

type Registration = { event: string; matcher: string | undefined; command: string };

// deno-lint-ignore no-explicit-any
function registrations(settings: any): Registration[] {
  const out: Registration[] = [];
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    // deno-lint-ignore no-explicit-any
    for (const g of groups as any[]) {
      for (const h of g.hooks ?? []) out.push({ event, matcher: g.matcher, command: h.command });
    }
  }
  return out;
}

const readSettings = async (dir: string) =>
  JSON.parse(await Deno.readTextFile(join(dir, ".claude/settings.json")));

/** Every `.sh` a command runs, as an absolute path in `dir`. */
function scriptsRun(command: string, dir: string): string[] {
  const expanded = command.replaceAll("$CLAUDE_PROJECT_DIR", dir);
  return [...expanded.matchAll(/[^\s"']+\.sh/g)].map(([p]) => isAbsolute(p) ? p : join(dir, p));
}

/**
 * Turn a fresh init into what 7.1.0 left, and return the registrations the
 * bundle wants — read from the init's own `settings.json`, written verbatim on
 * a greenfield project, so the oracle is the bundle rather than the merge.
 */
async function plant7_1(dir: string, customized: boolean): Promise<Registration[]> {
  const bundled = registrations(await readSettings(dir));
  await Deno.remove(join(dir, ".specnaut/hooks"), { recursive: true });
  const lock = await lockText(dir);
  const dropped = lock.replace(/^ {2}\.specnaut\/hooks\/.*:\n(?: {4}.*\n)*/gm, "");
  assert(dropped !== lock && !dropped.includes(".specnaut/hooks/"), "no hook rows to drop");
  await Deno.writeTextFile(join(dir, ".specnaut/installed.lock"), dropped);
  await plant(dir, [
    [OLD_PROTECT, customized ? EDITED : SHIPPED, SHIPPED],
    [OLD_LOG, SHIPPED, SHIPPED],
    [RETIRED, SHIPPED, SHIPPED],
  ]);
  await Deno.writeTextFile(join(dir, MINE), "#!/usr/bin/env bash\nexit 0\n");
  await Deno.writeTextFile(
    join(dir, ".claude/settings.json"),
    `${JSON.stringify(V7_1_SETTINGS, null, 2)}\n`,
  );
  return bundled;
}

/** SC-003, read off the file: each Specnaut hook once at its new path, the user's kept, none dangling. */
async function assertHooksMigrated(dir: string, bundled: Registration[], run: string) {
  const regs = registrations(await readSettings(dir));
  // Keyed on the group too: one script may guard two (spec 038 registers
  // protect-constitution.sh under both the Edit and the Bash matcher).
  for (const b of bundled) {
    const found = regs.filter((r) =>
      r.event === b.event && r.matcher === b.matcher && r.command === b.command
    );
    assertEquals(
      found.length,
      1,
      `${run}: ${b.event} ${b.matcher} \`${b.command}\` × ${found.length}`,
    );
  }
  const ours = (rs: Registration[]) => rs.filter((r) => r.command.includes(".specnaut/hooks/"));
  assertEquals(ours(regs).length, ours(bundled).length, `${run}: a stale Specnaut entry is left`);
  const retired = regs.filter((r) =>
    /\.claude\/hooks\/(protect-generated|log-subagent)\.sh/.test(r.command)
  );
  assertEquals(retired, [], `${run}: a retired command is still registered`);
  assertEquals(regs.filter((r) => r.command === MINE).length, 1, `${run}: the user's hook`);
  for (const r of regs) {
    const scripts = scriptsRun(r.command, dir);
    assert(scripts.length > 0, `${run}: no script read from \`${r.command}\``);
    for (const s of scripts) {
      assert(await exists(s), `${run}: \`${r.command}\` runs a missing ${s}`);
    }
  }
}

async function withProject(body: (dir: string, home: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-hooks71-" });
  const home = await Deno.makeTempDir({ prefix: "specnaut-home-" });
  try {
    const git = await new Deno.Command("git", { args: ["init", "-q", "-b", "main"], cwd: dir })
      .output();
    assertEquals(git.code, 0, new TextDecoder().decode(git.stderr));
    const init = await runSpecnaut(
      ["init", "--here", "--ai", "claude", "--backlog", "local"],
      dir,
      home,
    );
    assertEquals(init.code, 0, init.out);
    await body(dir, home);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
}

Deno.test("upgrade from 7.1.0 prunes the clean old hook copies and registers each hook once", async () => {
  await withProject(async (dir, home) => {
    const bundled = await plant7_1(dir, false);
    const up = await runSpecnaut(["upgrade"], dir, home);
    assertEquals(up.code, 0, up.out);
    const lock = await lockText(dir);
    for (const rel of [OLD_PROTECT, OLD_LOG, RETIRED]) {
      assertEquals(await exists(join(dir, rel)), false, `${rel} was not pruned:\n${up.out}`);
      assertEquals(await exists(join(dir, `${rel}.specnaut.bak`)), false, `${rel} backed up`);
      assert(!lock.includes(`  ${rel}:`), `${rel} is still in the lock`);
      assertStringIncludes(up.out, `✗ ${rel}`);
    }
    await assertHooksMigrated(dir, bundled, "upgrade");
    // A second run must not pile up one more entry: the splice is a fixed point.
    const settings = await Deno.readTextFile(join(dir, ".claude/settings.json"));
    const again = await runSpecnaut(["upgrade"], dir, home);
    assertEquals(again.code, 0, again.out);
    const after = await Deno.readTextFile(join(dir, ".claude/settings.json"));
    assertEquals(after, settings, "a second upgrade rewrote settings.json");
  });
});

Deno.test("upgrade from 7.1.0 keeps a customized old hook copy, warning, until --force", async () => {
  await withProject(async (dir, home) => {
    const bundled = await plant7_1(dir, true);
    const row = `  ${OLD_PROTECT}:\n    sha256: ${await sha256(SHIPPED)}\n`;
    for (const run of ["first upgrade", "second upgrade"]) {
      const up = await runSpecnaut(["upgrade"], dir, home);
      assertEquals(up.code, 0, up.out);
      assert(await exists(join(dir, OLD_PROTECT)), `${run} deleted the customized copy`);
      assertEquals(await Deno.readTextFile(join(dir, OLD_PROTECT)), EDITED, `${run} touched it`);
      assertStringIncludes(up.out, `⚠ ${OLD_PROTECT}`, run);
      assertStringIncludes(up.out, "1 orphan-preserved", run);
      assertStringIncludes(await lockText(dir), row, `${run} dropped the lock row`);
      for (const rel of [OLD_LOG, RETIRED]) {
        assertEquals(await exists(join(dir, rel)), false, `${run}: ${rel} was not pruned`);
      }
      await assertHooksMigrated(dir, bundled, run);
    }
    const forced = await runSpecnaut(["upgrade", "--force"], dir, home);
    assertEquals(forced.code, 0, forced.out);
    assertEquals(await exists(join(dir, OLD_PROTECT)), false, "--force left the customized copy");
    const bak = join(dir, `${OLD_PROTECT}.specnaut.bak`);
    assert(await exists(bak), "--force removed the customized copy without a backup");
    assertEquals(await Deno.readTextFile(bak), EDITED);
    assertStringIncludes(forced.out, "removed (was customized — backed up to .specnaut.bak)");
    assert(!(await lockText(dir)).includes(`  ${OLD_PROTECT}:`), "--force kept the lock row");
    await assertHooksMigrated(dir, bundled, "--force");
  });
});
