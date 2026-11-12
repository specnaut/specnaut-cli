import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { bundleForLock } from "../../src/application/lock_bundle.ts";
import { findHarness } from "../../src/cli/harnesses.ts";
import { parseLock } from "../../src/domain/installed_lock.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { LOCK } from "./verify_scripts_fixture.ts";

/**
 * The `PreToolUse` hook that runs `specnaut review guard`, as Claude Code runs it: its input on
 * stdin. A stub `specnaut` first on the PATH stands for the binary and says what it was given.
 */

const HOOK = fromFileUrl(
  new URL("../../templates/harness-specific/claude/hooks/review-lock.sh", import.meta.url),
);

async function runHook(project: string, input: string, stubExit = 0, path?: string) {
  const bin = await Deno.makeTempDir({ prefix: "review-lock-bin-" });
  try {
    const seen = join(bin, "seen");
    const stub = `#!/usr/bin/env bash\n{ echo "$*"; cat; } >"${seen}"\nexit ${stubExit}\n`;
    await Deno.writeTextFile(join(bin, "specnaut"), stub, { mode: 0o755 });
    const child = new Deno.Command("bash", {
      args: [HOOK],
      env: { PATH: path ?? `${bin}:${Deno.env.get("PATH")}`, CLAUDE_PROJECT_DIR: project },
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(input));
    await writer.close();
    const { code } = await child.output();
    return { code, called: await Deno.readTextFile(seen).catch(() => null) };
  } finally {
    await Deno.remove(bin, { recursive: true });
  }
}

const input = (session: string) =>
  JSON.stringify({ session_id: session, tool_name: "Bash", tool_input: { command: "git push" } });

async function inProject(fn: (project: string, locks: string) => Promise<void>) {
  const project = await Deno.makeTempDir({ prefix: "review-lock-project-" });
  try {
    await new Deno.Command("git", { args: ["init", "-q", project] }).output();
    await fn(project, join(project, ".git", "specnaut", "review-lock"));
  } finally {
    await Deno.remove(project, { recursive: true });
  }
}

Deno.test({
  name: "with no lock, or another session's, the call runs without starting the binary",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await inProject(async (project, locks) => {
      assertEquals(await runHook(project, input("s-1"), 2), { code: 0, called: null });
      await Deno.mkdir(locks, { recursive: true });
      assertEquals(await runHook(project, input("s-1"), 2), { code: 0, called: null }, "empty");
      await Deno.writeTextFile(join(locks, "s-2.json"), "{}");
      assertEquals(await runHook(project, input("s-1"), 2), { code: 0, called: null }, "other");
    });
    const bare = await Deno.makeTempDir({ prefix: "review-lock-none-" });
    try {
      assertEquals(await runHook(bare, input("s-1"), 2), { code: 0, called: null }, "no repo");
    } finally {
      await Deno.remove(bare, { recursive: true });
    }
  },
});

Deno.test({
  name: "a lock this call may be under hands the input to the guard, and any refusal stops it",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await inProject(async (project, locks) => {
      await Deno.mkdir(locks, { recursive: true });
      await Deno.writeTextFile(join(locks, "s-1.json"), "");
      const own = await runHook(project, input("s-1"), 0);
      assertEquals(own, { code: 0, called: `review guard\n${input("s-1")}` });
      assertEquals((await runHook(project, input("s-1"), 2)).code, 2);
      assertEquals((await runHook(project, input("s-1"), 1)).code, 2, "every failure stops it");
      // Input that does not open with the session id goes to the guard, whatever it names.
      const reordered = JSON.stringify({ tool_name: "Bash", session_id: "s-9" });
      assertEquals((await runHook(project, reordered, 2)).called !== null, true, "reordered");
      assertEquals((await runHook(project, "not json", 2)).code, 2, "no session id");
      const inner = `{"tool_input":{"session_id":"s-9"},"session_id":"s-1"}`;
      assertEquals((await runHook(project, inner, 2)).code, 2, "only the opening id is read");
      const nested = `{"session_id":"s-9\\u0022","x":1}`;
      assertEquals((await runHook(project, nested, 2)).code, 2, "an escaped id is not read");
    });
  },
});

Deno.test({
  name: "anything but a folder where the locks live, or no binary to judge, stops the call",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await inProject(async (project, locks) => {
      await Deno.mkdir(join(locks, ".."), { recursive: true });
      await Deno.writeTextFile(locks, "");
      assertEquals((await runHook(project, input("s-1"), 2)).code, 2, "a file");
      await Deno.remove(locks);
      await Deno.symlink(join(project, "elsewhere"), locks);
      assertEquals((await runHook(project, input("s-1"), 2)).code, 2, "a dangling link");
      await Deno.remove(locks);
      await Deno.mkdir(join(project, "elsewhere"));
      await Deno.symlink(join(project, "elsewhere"), locks);
      assertEquals((await runHook(project, input("s-1"), 2)).code, 2, "a link to a folder");
      await Deno.remove(locks);
      await Deno.mkdir(locks);
      await Deno.writeTextFile(join(locks, "s-1.json"), "");
      assertEquals((await runHook(project, input("s-1"), 0, "/usr/bin:/bin")).code, 2);
    });
  },
});

Deno.test({
  name: "the caller's GIT_DIR does not move where the hook looks for the lock",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await inProject(async (project, locks) => {
      await Deno.mkdir(locks, { recursive: true });
      await Deno.writeTextFile(join(locks, "s-1.json"), "");
      const elsewhere = await Deno.makeTempDir({ prefix: "review-lock-other-" });
      try {
        await new Deno.Command("git", { args: ["init", "-q", elsewhere] }).output();
        Deno.env.set("GIT_DIR", join(elsewhere, ".git"));
        assertEquals((await runHook(project, input("s-1"), 2)).code, 2);
      } finally {
        Deno.env.delete("GIT_DIR");
        await Deno.remove(elsewhere, { recursive: true });
      }
    });
  },
});

Deno.test("only Claude Code is scaffolded the lock's hook, run before every tool call", () => {
  for (const harness of ["claude", "codex", "copilot", "cursor", "opencode", "antigravity"]) {
    const lock = parseLock(LOCK.replace("harness: claude", `harness: ${harness}`));
    const files = bundleForLock(CORE_BUNDLE, lock, findHarness)!;
    const calling = Object.keys(files).filter((p) => files[p].content.includes("review-lock.sh"));
    assertEquals(calling, harness === "claude" ? [".claude/settings.json"] : [], harness);
  }
  const files = bundleForLock(CORE_BUNDLE, parseLock(LOCK), findHarness)!;
  assertEquals(files[".claude/hooks/review-lock.sh"]?.executable, true);
  const settings = JSON.parse(files[".claude/settings.json"].content);
  type Group = { matcher?: string; hooks: { command: string }[] };
  const groups = (settings.hooks.PreToolUse as Group[]).filter((g) =>
    g.hooks.some((h) => h.command.includes(".claude/hooks/review-lock.sh"))
  );
  assertEquals(groups.map((g) => g.matcher), ["*"]);
});
