import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { InitProjectUseCase } from "../../src/application/init_project.ts";
import { UpgradeProjectUseCase } from "../../src/application/upgrade_project.ts";
import type { GitAdapter } from "../../src/application/ports.ts";
import { sha256Hex } from "../../src/domain/sha256.ts";
import { CODEX_CONFIG_BLOCK_LABEL } from "../../src/domain/codex_config.ts";
import { canonicalBlockBody } from "../../src/domain/merge_block.ts";
import { CodexHarness } from "../../src/infrastructure/harness/codex_harness.ts";
import { DenoFsWriter } from "../../src/infrastructure/deno_fs_writer.ts";
import { DenoFsReader } from "../../src/infrastructure/fs_reader.ts";
import { FsLockStore } from "../../src/infrastructure/fs_lock_store.ts";
import { FsStagingStore } from "../../src/infrastructure/fs_staging_store.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { readLinkText } from "../helpers/link_text.ts";

/**
 * A Codex project scaffolded before cli#681, upgraded: `.codex/AGENTS.md`
 * becomes the link, the retired `.codex/goal.md` leaves (only when untouched),
 * the `[agents]` block gains `enabled = true`, and a second run changes nothing.
 * Real adapter, real filesystem, the old state planted as an older release left it.
 */

const harness = new CodexHarness();
const noGit: GitAdapter = {
  isAvailable: () => Promise.resolve(false),
  isInitialized: () => Promise.resolve(false),
  init: () => Promise.resolve(),
  getRemoteUrl: () => Promise.resolve(null),
};
const OLD_AGENTS = "# Codex Reference\n\n- old pointer\n";
const OLD_GOAL = "# Project goal prompt\n";
/** The block as it was before `enabled = true`. */
const OLD_BLOCK = '[agents]\ndefault_subagent_model = "x"\nmax_concurrent_threads_per_session = 4';

async function oldCodexProject(dir: string, goal: string) {
  await new InitProjectUseCase({
    writer: new DenoFsWriter(),
    git: noGit,
    lockStore: new FsLockStore(),
    harness,
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    core: CORE_BUNDLE,
    ensureDir: (p) => Deno.mkdir(p, { recursive: true }),
  }).execute({ targetDir: dir, initGit: false, force: false, dryRun: false });
  await Deno.remove(join(dir, ".codex/AGENTS.md"));
  await Deno.writeTextFile(join(dir, ".codex/AGENTS.md"), OLD_AGENTS);
  await Deno.writeTextFile(join(dir, ".codex/goal.md"), goal);
  const label = CODEX_CONFIG_BLOCK_LABEL;
  await Deno.writeTextFile(
    join(dir, ".codex/config.toml"),
    `# --- Specnaut: ${label} ---\n${OLD_BLOCK}\n# --- End Specnaut: ${label} ---\n`,
  );
  const store = new FsLockStore();
  const lock = (await store.read(dir))!;
  const entries = new Map(lock.entries);
  const at = (sha: string) => ({ sha256: sha, installedAt: "t", templatesVersion: "0.0.1" });
  entries.set(".codex/AGENTS.md", at(await sha256Hex(OLD_AGENTS)));
  entries.set(".codex/goal.md", at(await sha256Hex(OLD_GOAL)));
  entries.set(".codex/config.toml", at(await sha256Hex(canonicalBlockBody(OLD_BLOCK))));
  await store.write(dir, { ...lock, templatesVersion: "0.0.1", entries });
}

const upgrade = (dir: string) =>
  new UpgradeProjectUseCase({
    reader: new DenoFsReader(),
    writer: new DenoFsWriter(),
    lockStore: new FsLockStore(),
    stagingStore: new FsStagingStore(),
    core: CORE_BUNDLE,
    templatesVersion: "9.9.9",
    findHarness: () => harness,
  }).execute({ projectDir: dir, dryRun: false, force: false });

async function withProject(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const exists = (p: string) => Deno.lstat(p).then(() => true, () => false);

Deno.test("upgrade links .codex/AGENTS.md, retires goal.md, enables agents, then rests", async () => {
  await withProject(async (dir) => {
    await oldCodexProject(dir, OLD_GOAL);
    const r = await upgrade(dir);
    assert(r.status === "applied", r.status);
    assertEquals(await readLinkText(join(dir, ".codex/AGENTS.md")), "../AGENTS.md");
    assertEquals(await exists(join(dir, ".codex/goal.md")), false, "a vanilla goal.md stays");
    assertEquals(r.backups, [], "nothing here was the user's");
    const config = await Deno.readTextFile(join(dir, ".codex/config.toml"));
    assert(/^enabled = true$/m.test(config), config);
    assert(/^max_concurrent_threads_per_session = \d+$/m.test(config), config);
    const lock = await new FsLockStore().read(dir);
    assertEquals(lock?.entries.has(".codex/goal.md"), false);

    assertEquals((await upgrade(dir)).status, "up-to-date");
  });
});

Deno.test("a customized goal.md is kept and reported, not deleted", async () => {
  await withProject(async (dir) => {
    await oldCodexProject(dir, "# my own goal\n");
    const r = await upgrade(dir);
    assert(r.status === "applied", r.status);
    assertEquals(await Deno.readTextFile(join(dir, ".codex/goal.md")), "# my own goal\n");
    assert(
      r.plan.some((a) => a.kind === "remove" && a.dest === ".codex/goal.md" && a.wasCustomized),
      "the kept file must be named in the report",
    );
  });
});
