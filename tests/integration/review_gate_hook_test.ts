import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { bundleForLock } from "../../src/application/lock_bundle.ts";
import { findHarness } from "../../src/cli/harnesses.ts";
import { parseLock } from "../../src/domain/installed_lock.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { LOCK } from "./verify_scripts_fixture.ts";

/**
 * The `PreToolUse` hook that runs `specnaut review gate`, as Claude Code runs it: its input on
 * stdin. A stub `specnaut` first on the PATH stands for the binary and says what it was given.
 */

const HOOK = fromFileUrl(
  new URL("../../templates/harness-specific/claude/hooks/review-gate.sh", import.meta.url),
);

async function runHook(input: string, stubExit: number) {
  const dir = await Deno.makeTempDir({ prefix: "review-hook-" });
  try {
    const seen = join(dir, "seen");
    const stub = `#!/usr/bin/env bash\n{ echo "$*"; cat; } >"${seen}"\nexit ${stubExit}\n`;
    await Deno.writeTextFile(join(dir, "specnaut"), stub, { mode: 0o755 });
    const out = await new Deno.Command("bash", {
      args: [HOOK],
      env: { PATH: `${dir}:${Deno.env.get("PATH")}`, CLAUDE_PROJECT_DIR: dir },
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = out.stdin.getWriter();
    await writer.write(new TextEncoder().encode(input));
    await writer.close();
    const { code } = await out.output();
    const called = await Deno.readTextFile(seen).catch(() => null);
    return { code, called };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const START = JSON.stringify({
  session_id: "s",
  tool_input: { command: "specnaut review start 1" },
});

Deno.test({
  name: "the hook hands a review's input to the gate, and any refusal stops the command",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const allowed = await runHook(START, 0);
    assertEquals(allowed.code, 0);
    assertEquals(allowed.called, `review gate\n${START}`);
    assertEquals((await runHook(START, 2)).code, 2);
    assertEquals((await runHook(START, 1)).code, 2, "every failure of the gate stops it");
    const other = await runHook(JSON.stringify({ tool_input: { command: "ls" } }), 2);
    assertEquals(other, { code: 0, called: null });
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
