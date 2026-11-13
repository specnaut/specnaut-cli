import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { bundleForLock } from "../../src/application/lock_bundle.ts";
import { findHarness } from "../../src/cli/harnesses.ts";
import { parseLock } from "../../src/domain/installed_lock.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { LOCK } from "./verify_scripts_fixture.ts";

/**
 * The `PreToolUse` hook that runs `specnaut review gate`, as Claude Code runs it: its input on
 * stdin. A stub `specnaut` first on the PATH stands for the binary and says what it was given,
 * and whether a pass was still there when it ran.
 */

const HOOK = fromFileUrl(
  new URL("../../templates/harness-specific/claude/hooks/review-gate.sh", import.meta.url),
);

async function runHook(input: string, stubExit: number, path?: string, project?: string) {
  const dir = await Deno.makeTempDir({ prefix: "review-hook-" });
  try {
    const seen = join(dir, "seen");
    const held = join(dir, "held");
    const stub = `#!/usr/bin/env bash\n{ echo "$*"; cat; } >"${seen}"\n` +
      `[ -e "$CLAUDE_PROJECT_DIR/.git/specnaut/review-pass.json" ] && : >"${held}"\n` +
      `printf '%s' '{"answer":"from the gate"}'\nexit ${stubExit}\n`;
    await Deno.writeTextFile(join(dir, "specnaut"), stub, { mode: 0o755 });
    const out = await new Deno.Command("bash", {
      args: [HOOK],
      env: { PATH: path ?? `${dir}:${Deno.env.get("PATH")}`, CLAUDE_PROJECT_DIR: project ?? dir },
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = out.stdin.getWriter();
    await writer.write(new TextEncoder().encode(input));
    await writer.close();
    const { code, stdout } = await out.output();
    const called = await Deno.readTextFile(seen).catch(() => null);
    const said = new TextDecoder().decode(stdout);
    return { code, called, held: await Deno.lstat(held).then(() => true, () => false), said };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const START = JSON.stringify({
  session_id: "s",
  tool_input: { command: "specnaut review start 1" },
});

Deno.test({
  name:
    "the hook hands a review's input to the gate, answers with what the gate printed, and any refusal stops the command",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const allowed = await runHook(START, 0);
    assertEquals(allowed.code, 0);
    assertEquals(allowed.called, `review gate\n${START}`);
    assertEquals(allowed.said, `{"answer":"from the gate"}`, "the gate's answer is the hook's");
    assertEquals((await runHook(START, 2)).code, 2);
    assertEquals((await runHook(START, 1)).code, 2, "every failure of the gate stops it");
    const other = await runHook(JSON.stringify({ tool_input: { command: "ls" } }), 2);
    assertEquals(other, { code: 0, called: null, held: false, said: "" });
  },
});

Deno.test({
  name: "every command removes the pass before anything else runs, the gate's own included",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const project = await Deno.makeTempDir({ prefix: "review-hook-project-" });
    try {
      await new Deno.Command("git", { args: ["init", "-q", project] }).output();
      const pass = join(project, ".git", "specnaut", "review-pass.json");
      await Deno.mkdir(join(project, ".git", "specnaut"));
      const ls = JSON.stringify({ tool_input: { command: "ls" } });
      const runs = [[ls, undefined, false], [START, "/usr/bin:/bin", false], [
        START,
        undefined,
        true,
      ]];
      for (const [input, path, gated] of runs as [string, string | undefined, boolean][]) {
        await Deno.writeTextFile(pass, '{"granted":1,"baseTip":""}\n');
        const run = await runHook(input, 0, path, project);
        assertEquals([run.code, run.called !== null, run.held], [0, gated, false], input);
        const left = await Deno.lstat(pass).then(() => true, () => false);
        assertEquals(left, false, `the pass outlived ${input}`);
      }
    } finally {
      await Deno.remove(project, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "a project whose git directory cannot be found stops every command; one in no repository does not",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const project = await Deno.makeTempDir({ prefix: "review-hook-project-" });
    try {
      const ls = JSON.stringify({ tool_input: { command: "ls" } });
      assertEquals((await runHook(ls, 0, undefined, project)).code, 0, "no repository, no pass");
      for (const named of [`gitdir: ${join(project, "missing")}`, "not a gitdir line"]) {
        await Deno.writeTextFile(join(project, ".git"), `${named}\n`);
        for (const input of [ls, START]) {
          const run = await runHook(input, 0, undefined, project);
          assertEquals(run, { code: 2, called: null, held: false, said: "" }, `${named}: ${input}`);
        }
      }
      const gone = join(project, "gone");
      assertEquals((await runHook(ls, 0, undefined, gone)).code, 2, "no project folder");
    } finally {
      await Deno.remove(project, { recursive: true });
    }
  },
});

Deno.test({
  name: "where git cannot read the repository, the pass is removed from the folder .git names",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const project = await Deno.makeTempDir({ prefix: "review-hook-project-" });
    try {
      await Deno.mkdir(join(project, "store", "specnaut"), { recursive: true });
      const pass = join(project, "store", "specnaut", "review-pass.json");
      await Deno.writeTextFile(pass, '{"granted":1,"baseTip":""}\n');
      await Deno.writeTextFile(join(project, ".git"), "gitdir: store\r\n");
      const ls = JSON.stringify({ tool_input: { command: "ls" } });
      const run = await runHook(ls, 0, undefined, project);
      assertEquals(run.code, 0);
      assertEquals(await Deno.lstat(pass).then(() => true, () => false), false);
    } finally {
      await Deno.remove(project, { recursive: true });
    }
  },
});

Deno.test("only Claude Code is scaffolded the gate hook, registered before every shell command", () => {
  for (const harness of ["claude", "codex", "copilot", "cursor", "opencode", "antigravity"]) {
    const lock = parseLock(LOCK.replace("harness: claude", `harness: ${harness}`));
    const files = bundleForLock(CORE_BUNDLE, lock, findHarness)!;
    const calling = Object.keys(files).filter((p) => files[p].content.includes("review-gate.sh"));
    assertEquals(calling, harness === "claude" ? [".claude/settings.json"] : [], harness);
  }
  const lock = parseLock(LOCK);
  const settings = JSON.parse(
    bundleForLock(CORE_BUNDLE, lock, findHarness)![".claude/settings.json"].content,
  );
  const bash = settings.hooks.PreToolUse.find((h: { matcher: string }) => h.matcher === "Bash");
  assertStringIncludes(bash.hooks[0].command, ".claude/hooks/review-gate.sh");
});
