import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join, relative } from "@std/path";
import { exists, walk } from "@std/fs";

/**
 * #659 — a project installed for a harness Specnaut has since removed.
 *
 * Its lock is not corrupt, it is left behind. Every command that loads it must
 * say so once, exit 1, change nothing, and name a way off the harness that
 * actually works — this file runs that exact command to prove it.
 */

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

async function runSpecnaut(args: string[], cwd: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  // Colour codes split `file.ts:12` into pieces a stack-trace pattern misses.
  // deno-lint-ignore no-control-regex
  const plain = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\x1b\[[0-9;]*m/g, "");
  return { code, stdout: plain(stdout), stderr: plain(stderr) };
}

/**
 * A project as a Windsurf install left it: the shared `.specnaut/` files every
 * harness writes, a lock naming `windsurf`, and its own `.windsurf/` tree.
 * Built from a current install rather than typed by hand, so the shared files
 * are real — they are what makes a plain re-`init` stop on conflicts, which is
 * the case the notice's command has to get past. Content is invented.
 */
async function windsurfProject(dir: string): Promise<void> {
  const init = await runSpecnaut(
    ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"],
    dir,
  );
  assertEquals(init.code, 0, init.stderr);
  await Deno.remove(join(dir, ".claude"), { recursive: true });
  const lockPath = join(dir, ".specnaut/installed.lock");
  const lock = await Deno.readTextFile(lockPath);
  assertStringIncludes(lock, "harness: claude");
  await Deno.writeTextFile(lockPath, lock.replace("harness: claude", "harness: windsurf"));
  await Deno.mkdir(join(dir, ".windsurf/workflows"), { recursive: true });
  await Deno.writeTextFile(join(dir, ".windsurf/workflows/specnaut-plan.md"), "# plan\n");
  await Deno.writeTextFile(join(dir, "AGENTS.md"), "# AGENTS.md\n\nWe rebase.\n");
}

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  // Directories too: a command that only creates an empty staging dir has
  // still changed the project.
  for await (const e of walk(dir)) {
    out[relative(dir, e.path)] = e.isDirectory ? "<dir>" : await Deno.readTextFile(e.path);
  }
  return out;
}

async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-removed-harness-" });
  try {
    await windsurfProject(dir);
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const NOTICE = "this project was installed for windsurf, which Specnaut no longer supports";

for (
  const args of [
    ["upgrade"],
    ["upgrade", "--dry-run"],
    ["upgrade", "--backlog", "github"],
    ["diff"],
    ["diff", "AGENTS.md"],
    ["reconcile", "--status"],
    ["reconcile", "AGENTS.md", "--accept-current"],
    ["check", "--project"],
  ]
) {
  Deno.test(`${args.join(" ")} on a removed harness: one notice, exit 1, nothing changed`, async () => {
    await withProject(async (dir) => {
      const before = await snapshot(dir);
      const r = await runSpecnaut(args, dir);
      const out = r.stdout + r.stderr;
      assertEquals(r.code, 1, out);
      assertStringIncludes(out, NOTICE);
      assertStringIncludes(out, "Nothing was changed.");
      assertEquals(out.split(NOTICE).length - 1, 1, `notice repeated:\n${out}`);
      assert(!/\n\s+at .*\.ts:\d+/.test(out), `stack trace leaked:\n${out}`);
      assert(!out.includes("Unsupported harness"), out);
      assertEquals(await snapshot(dir), before, "the project changed");
    });
  });
}

Deno.test("init --ai windsurf names the removal and the supported harnesses", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-removed-harness-" });
  try {
    const r = await runSpecnaut(["init", "--here", "--no-git", "--ai", "windsurf"], dir);
    assertEquals(r.code, 1, r.stderr);
    assertStringIncludes(r.stderr, "windsurf is no longer supported");
    assertStringIncludes(r.stderr, "Supported harnesses: claude,");
    assert(!r.stderr.includes("Unknown command"), r.stderr);
    assertEquals([...Deno.readDirSync(dir)].length, 0, "init wrote something");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the migration the notice names works, and keeps what it replaces", async () => {
  await withProject(async (dir) => {
    const r = await runSpecnaut(["upgrade"], dir);
    // Take the command from the message itself: a test that typed its own
    // would stay green while the message recommended something else.
    const m = r.stderr.match(/`(specnaut init [^`]*)`/);
    assert(m, `no command in the notice:\n${r.stderr}`);
    const words = m[1].split(" ").slice(1).map((w) => w === "<harness>" ? "claude" : w);
    assertEquals(words, ["init", "--here", "--force", "--ai", "claude"]);

    const init = await runSpecnaut([...words, "--no-git", "--backlog", "local"], dir);
    assertEquals(init.code, 0, init.stderr);
    const lock = await Deno.readTextFile(join(dir, ".specnaut/installed.lock"));
    assertStringIncludes(lock, "harness: claude");
    assert(await exists(join(dir, ".windsurf/workflows/specnaut-plan.md")), ".windsurf/ removed");
    assertEquals(
      await Deno.readTextFile(join(dir, "AGENTS.md.specnaut.bak")),
      "# AGENTS.md\n\nWe rebase.\n",
    );

    const up = await runSpecnaut(["upgrade"], dir);
    assertEquals(up.code, 0, up.stderr);
  });
});

Deno.test("init without --force on a removed harness points at --force, not at upgrade", async () => {
  await withProject(async (dir) => {
    const r = await runSpecnaut(["init", "--here", "--no-git", "--ai", "claude"], dir);
    assertEquals(r.code, 3, r.stderr);
    assertStringIncludes(r.stderr, "specnaut init --here --force");
    assert(!r.stderr.includes("run specnaut upgrade"), r.stderr);
    assert(!r.stderr.includes(NOTICE), r.stderr);
  });
});
