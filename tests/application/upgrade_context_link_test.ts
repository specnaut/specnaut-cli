import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { InitProjectUseCase } from "../../src/application/init_project.ts";
import { UpgradeProjectUseCase } from "../../src/application/upgrade_project.ts";
import type { GitAdapter, Harness } from "../../src/application/ports.ts";
import type { Bundle } from "../../src/domain/template.ts";
import { sha256Hex } from "../../src/domain/sha256.ts";
import { linkIdentity } from "../../src/domain/context_link.ts";
import { DenoFsWriter, type Linker } from "../../src/infrastructure/deno_fs_writer.ts";
import { DenoFsReader } from "../../src/infrastructure/fs_reader.ts";
import { FsLockStore } from "../../src/infrastructure/fs_lock_store.ts";
import { FsStagingStore } from "../../src/infrastructure/fs_staging_store.ts";

/**
 * A context link through the real init and upgrade use cases, on a real
 * filesystem (cli#680, cli#681): every prior state of the destination, and the
 * second run that must change nothing.
 */

const DEST = ".claude/CLAUDE.md";
const BUNDLE: Bundle = {
  "AGENTS.md": { content: "# AGENTS\n", executable: false, skipIfExists: true },
  [DEST]: { content: "@../AGENTS.md\n", executable: false, symlinkTo: "../AGENTS.md" },
};
const harness: Harness = { key: "claude", displayName: "Claude (test)", mapBundle: () => BUNDLE };
const noGit: GitAdapter = {
  isAvailable: () => Promise.resolve(false),
  isInitialized: () => Promise.resolve(false),
  init: () => Promise.resolve(),
  getRemoteUrl: () => Promise.resolve(null),
};
const refusing: Linker = () => Promise.reject(new Deno.errors.PermissionDenied("no privilege"));

async function initProject(dir: string, linker?: Linker) {
  return await new InitProjectUseCase({
    writer: new DenoFsWriter(linker),
    git: noGit,
    lockStore: new FsLockStore(),
    harness,
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    core: [],
    ensureDir: (p) => Deno.mkdir(p, { recursive: true }),
  }).execute({ targetDir: dir, initGit: false, force: false, dryRun: false });
}

async function upgrade(
  dir: string,
  opts: { linker?: Linker; force?: boolean; declared?: string[] } = {},
) {
  return await new UpgradeProjectUseCase({
    reader: new DenoFsReader(),
    writer: new DenoFsWriter(opts.linker),
    lockStore: new FsLockStore(),
    stagingStore: new FsStagingStore(),
    core: [],
    templatesVersion: "9.9.9",
    findHarness: () => harness,
  }).execute({
    projectDir: dir,
    dryRun: false,
    force: opts.force ?? false,
    isDeclaredPreserved: (d) => (opts.declared ?? []).includes(d),
  });
}

async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Put `content` at the destination as a plain file, recorded in the lock with `lockedAs`. */
async function plantFile(dir: string, content: string, lockedAs: string) {
  await Deno.remove(join(dir, DEST));
  await Deno.writeTextFile(join(dir, DEST), content);
  const store = new FsLockStore();
  const lock = (await store.read(dir))!;
  const entries = new Map(lock.entries);
  entries.set(DEST, { ...entries.get(DEST)!, sha256: await sha256Hex(lockedAs) });
  await store.write(dir, { ...lock, entries });
}

const isOurLink = async (dir: string) =>
  (await Deno.lstat(join(dir, DEST))).isSymlink &&
  (await Deno.readLink(join(dir, DEST))) === "../AGENTS.md";

Deno.test("init links the context file and the next upgrade is a no-op", async () => {
  await withProject(async (dir) => {
    const init = await initProject(dir);
    assert(init.status === "initialized");
    assertEquals(init.contextLinks, [{ dest: DEST, target: "../AGENTS.md", form: "symlink" }]);
    assert(await isOurLink(dir));
    const again = await upgrade(dir);
    assertEquals(again.status, "up-to-date");
  });
});

Deno.test("upgrade replaces a generated context file with the link, without a backup", async () => {
  await withProject(async (dir) => {
    await initProject(dir);
    await plantFile(dir, "# Claude Reference\n", "# Claude Reference\n");
    const r = await upgrade(dir);
    assert(r.status === "applied");
    assert(r.plan.some((a) => a.kind === "auto-update" && a.dest === DEST));
    assertEquals(r.backups, []);
    assert(await isOurLink(dir));
    assertEquals((await upgrade(dir)).status, "up-to-date");
  });
});

Deno.test("upgrade replaces a customized context file with the link and backs it up", async () => {
  await withProject(async (dir) => {
    await initProject(dir);
    await plantFile(dir, "# my own rules\n", "# Claude Reference\n");
    const r = await upgrade(dir);
    assert(r.status === "applied");
    assert(r.plan.some((a) => a.kind === "replace-with-link" && a.previous === "customized-file"));
    assertEquals(r.backups, [DEST]);
    assertEquals(await Deno.readTextFile(join(dir, `${DEST}.specnaut.bak`)), "# my own rules\n");
    assert(await isOurLink(dir));
    // The run that relinked records the link's identity, whichever form it wrote.
    assert(r.written.includes(DEST));
    const entry = (await new FsLockStore().read(dir))?.entries.get(DEST);
    assertEquals(entry?.sha256, await sha256Hex(linkIdentity("../AGENTS.md")));
    // Idempotent: no second backup, no "customized" report.
    const again = await upgrade(dir);
    assertEquals(again.status, "up-to-date");
  });
});

Deno.test("a preserve.yml declaration keeps a customized context file as it is", async () => {
  await withProject(async (dir) => {
    await initProject(dir);
    await plantFile(dir, "# my own rules\n", "# Claude Reference\n");
    const r = await upgrade(dir, { declared: [DEST] });
    assert(r.status === "applied", r.status);
    assert(r.plan.some((a) => a.kind === "preserve" && a.dest === DEST && a.reason === "declared"));
    assertEquals(r.backups, []);
    assertEquals(await Deno.readTextFile(join(dir, DEST)), "# my own rules\n");
  });
});

Deno.test("a declaration wins over an inverted consolidation too: preserved, not refused", async () => {
  await withProject(async (dir) => {
    await initProject(dir);
    await Deno.remove(join(dir, DEST));
    await Deno.writeTextFile(join(dir, DEST), "# everything we wrote\n");
    await Deno.remove(join(dir, "AGENTS.md"));
    await Deno.symlink(".claude/CLAUDE.md", join(dir, "AGENTS.md"));
    const r = await upgrade(dir, { declared: [DEST] });
    assertEquals(r.refusals, []);
    assert(r.status === "applied", r.status);
    assert(r.plan.some((a) => a.kind === "preserve" && a.dest === DEST && a.reason === "declared"));
    assertEquals(await Deno.readTextFile(join(dir, DEST)), "# everything we wrote\n");
  });
});

Deno.test("a link checked out as text (core.symlinks=false) is relinked and said", async () => {
  await withProject(async (dir) => {
    await initProject(dir);
    await plantFile(dir, "../AGENTS.md", "something else");
    const r = await upgrade(dir);
    assert(r.status === "applied");
    assertEquals(r.backups, []);
    assert(await isOurLink(dir));
    assert(
      r.notes.some((n) => n.includes("core.symlinks=false") && n.includes(DEST)),
      r.notes.join("\n"),
    );
  });
});

Deno.test("AGENTS.md linking back to the context file is refused, never relinked", async () => {
  await withProject(async (dir) => {
    await initProject(dir);
    await Deno.remove(join(dir, DEST));
    await Deno.writeTextFile(join(dir, DEST), "# everything we wrote\n");
    await Deno.remove(join(dir, "AGENTS.md"));
    await Deno.symlink(".claude/CLAUDE.md", join(dir, "AGENTS.md"));
    const r = await upgrade(dir);
    assert(
      r.refusals.some((m) => m.includes("AGENTS.md links to .claude/CLAUDE.md")),
      r.refusals.join("\n"),
    );
    assertEquals(await Deno.readTextFile(join(dir, DEST)), "# everything we wrote\n");
    assert(!(await Deno.lstat(join(dir, DEST))).isSymlink);
    if (r.status === "applied") assertEquals(r.backups, []);
  });
});

Deno.test("a foreign link pointing out of the project is replaced, its target untouched", async () => {
  await withProject(async (dir) => {
    const outside = await Deno.makeTempDir();
    try {
      await initProject(dir);
      await Deno.writeTextFile(join(outside, "theirs.md"), "theirs\n");
      await Deno.remove(join(dir, DEST));
      await Deno.symlink(join(outside, "theirs.md"), join(dir, DEST));
      const r = await upgrade(dir);
      assert(r.status === "applied");
      assert(r.plan.some((a) => a.kind === "replace-with-link" && a.previous === "foreign-link"));
      assertEquals(r.linksMoved, [DEST]);
      assert(await isOurLink(dir));
      assertEquals(await Deno.readTextFile(join(outside, "theirs.md")), "theirs\n");
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  });
});

Deno.test("where links are refused, init and upgrade write the fallback, and stay idempotent", async () => {
  await withProject(async (dir) => {
    const init = await initProject(dir, refusing);
    assert(init.status === "initialized");
    assertEquals(init.contextLinks.map((l) => l.form), ["fallback"]);
    assertStringIncludes(init.contextLinks[0].reason ?? "", "PermissionDenied");
    assertEquals(await Deno.readTextFile(join(dir, DEST)), "@../AGENTS.md\n");
    // Our fallback is ours: no retry, no rewrite, so a system that cannot make
    // links does not see a change on every run.
    assertEquals((await upgrade(dir, { linker: refusing })).status, "up-to-date");
    // A customized file on such a system still gets the fallback, and a backup.
    await plantFile(dir, "# mine\n", "# Claude Reference\n");
    const r = await upgrade(dir, { linker: refusing });
    assert(r.status === "applied");
    assertEquals(r.contextLinks.map((l) => l.form), ["fallback"]);
    assertEquals(r.backups, [DEST]);
    assertEquals(await Deno.readTextFile(join(dir, DEST)), "@../AGENTS.md\n");
  });
});
