import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { InitProjectUseCase } from "../../src/application/init_project.ts";
import type { GitAdapter, Harness } from "../../src/application/ports.ts";
import type { Bundle } from "../../src/domain/template.ts";
import { DenoFsWriter, type Linker } from "../../src/infrastructure/deno_fs_writer.ts";
import { FsLockStore } from "../../src/infrastructure/fs_lock_store.ts";

/**
 * `init --force` over a context link (cli#687), through the real use case on a
 * real filesystem. A forced run backs up what it replaces — but Specnaut's own
 * one-line fallback is not the user's, and on a system that cannot make links
 * every forced run would otherwise leave one more `.specnaut.bak` of it.
 */

const DEST = ".claude/CLAUDE.md";
const FALLBACK = "@../AGENTS.md\n";
const BUNDLE: Bundle = {
  "AGENTS.md": { content: "# AGENTS\n", executable: false, skipIfExists: true },
  [DEST]: { content: FALLBACK, executable: false, symlinkTo: "../AGENTS.md" },
};
const harness: Harness = { key: "claude", displayName: "Claude (test)", mapBundle: () => BUNDLE };
const noGit: GitAdapter = {
  isAvailable: () => Promise.resolve(false),
  isInitialized: () => Promise.resolve(false),
  init: () => Promise.resolve(),
  getRemoteUrl: () => Promise.resolve(null),
};
const refusing: Linker = () => Promise.reject(new Deno.errors.PermissionDenied("no privilege"));

async function init(dir: string, force: boolean, linker?: Linker) {
  const result = await new InitProjectUseCase({
    writer: new DenoFsWriter(linker),
    git: noGit,
    lockStore: new FsLockStore(),
    harness,
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    core: [],
    ensureDir: (p) => Deno.mkdir(p, { recursive: true }),
  }).execute({ targetDir: dir, initGit: false, force, dryRun: false });
  assert(result.status === "initialized", result.status);
  return result;
}

/** The context file's own backups, whatever else a forced init backs up. */
const linkBackups = (r: { backups: string[] }) => r.backups.filter((d) => d === DEST);

/** Every entry beside the context file: a backup shows up here. */
async function claudeDir(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const e of Deno.readDir(join(dir, ".claude"))) names.push(e.name);
  return names.sort();
}

async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("init --force where links are refused keeps our fallback without backing it up", async () => {
  await withProject(async (dir) => {
    await init(dir, false, refusing);
    for (let run = 0; run < 2; run++) {
      const forced = await init(dir, true, refusing);
      assertEquals(linkBackups(forced), [], `run ${run}`);
      assertEquals(forced.contextLinks.map((l) => l.form), ["fallback"]);
      assertEquals(await claudeDir(dir), ["CLAUDE.md"], `run ${run} left a backup`);
      assertEquals(await Deno.readTextFile(join(dir, DEST)), FALLBACK);
    }
  });
});

Deno.test("init --force replaces our fallback with the link once links work, no backup", {
  ignore: Deno.build.os === "windows",
}, async () => {
  await withProject(async (dir) => {
    await init(dir, false, refusing);
    const forced = await init(dir, true);
    assertEquals(linkBackups(forced), []);
    assertEquals(forced.contextLinks.map((l) => l.form), ["symlink"]);
    assert((await Deno.lstat(join(dir, DEST))).isSymlink);
    assertEquals(await claudeDir(dir), ["CLAUDE.md"]);
  });
});

Deno.test("init --force still backs up a context file that is not ours", async () => {
  await withProject(async (dir) => {
    await init(dir, false, refusing);
    // Our fallback's text with a line added is the user's file, not ours.
    await Deno.writeTextFile(join(dir, DEST), `${FALLBACK}# my notes\n`);
    const forced = await init(dir, true, refusing);
    assertEquals(linkBackups(forced), [DEST]);
    assertEquals(await Deno.readTextFile(join(dir, DEST)), FALLBACK);
    const backups = (await claudeDir(dir)).filter((n) => n !== "CLAUDE.md");
    assertEquals(backups.length, 1);
    assertEquals(
      await Deno.readTextFile(join(dir, ".claude", backups[0])),
      `${FALLBACK}# my notes\n`,
    );
  });
});
