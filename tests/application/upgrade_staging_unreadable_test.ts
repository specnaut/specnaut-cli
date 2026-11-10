import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { InitProjectUseCase } from "../../src/application/init_project.ts";
import { UpgradeProjectUseCase } from "../../src/application/upgrade_project.ts";
import type { GitAdapter, Harness } from "../../src/application/ports.ts";
import { DenoFsWriter } from "../../src/infrastructure/deno_fs_writer.ts";
import { DenoFsReader } from "../../src/infrastructure/fs_reader.ts";
import { FsLockStore } from "../../src/infrastructure/fs_lock_store.ts";
import { FsStagingStore } from "../../src/infrastructure/fs_staging_store.ts";
import { WINDOWS } from "../helpers/link_text.ts";
import { RUNS_AS_ROOT } from "../helpers/posix_modes.ts";

/**
 * cli#753: an unreadable staged subfolder aborted `upgrade`. The staging prune
 * listed the tree outside its `try`, so the walk's `PermissionDenied` left the
 * run before the managed sections, the deletes and the lock write. Listing is
 * best-effort now: one line, nothing deleted, and the upgrade finishes, on both
 * paths that prune — the project already current, and the one with file work.
 *
 * The real use cases on a real folder. POSIX only, because a mode is how the
 * folder refuses and Windows has none; and not as root, who reads through any
 * mode. Ignored there, never returned from early.
 */

const DEST = "docs/guide.md";
const VERSION = "9.9.9";

const harnessWith = (content: string): Harness => ({
  key: "claude",
  displayName: "Claude (test)",
  mapBundle: () => ({ [DEST]: { content, executable: false } }),
});

const noGit: GitAdapter = {
  isAvailable: () => Promise.resolve(false),
  isInitialized: () => Promise.resolve(false),
  init: () => Promise.resolve(),
  getRemoteUrl: () => Promise.resolve(null),
};

async function initProject(dir: string): Promise<void> {
  await new InitProjectUseCase({
    writer: new DenoFsWriter(),
    git: noGit,
    lockStore: new FsLockStore(),
    harness: harnessWith("v1\n"),
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    core: [],
    ensureDir: (p) => Deno.mkdir(p, { recursive: true }),
  }).execute({ targetDir: dir, initGit: false, force: false, dryRun: false });
}

/** An initialised project whose staging holds one stale copy and one folder no one can list. */
async function seedUnreadableStaging(dir: string, staging: string): Promise<void> {
  await initProject(dir);
  await Deno.mkdir(join(staging, "locked"), { recursive: true });
  await Deno.writeTextFile(join(staging, "stale.md"), "old upstream\n");
  await Deno.chmod(join(staging, "locked"), 0o000);
}

function upgrade(dir: string, content: string) {
  return new UpgradeProjectUseCase({
    reader: new DenoFsReader(),
    writer: new DenoFsWriter(),
    lockStore: new FsLockStore(),
    stagingStore: new FsStagingStore(),
    core: [],
    templatesVersion: VERSION,
    findHarness: () => harnessWith(content),
  }).execute({ projectDir: dir, dryRun: false, force: false, isDeclaredPreserved: () => false });
}

for (const [content, status] of [["v1\n", "up-to-date"], ["v2\n", "applied"]] as const) {
  Deno.test({
    name: `upgrade finishes ${status} over an unreadable staged folder, and says so`,
    ignore: WINDOWS || RUNS_AS_ROOT,
    fn: async () => {
      const dir = await Deno.makeTempDir({ prefix: "staging-unreadable-" });
      const staging = join(dir, ".specnaut/upgrade-staging");
      try {
        await seedUnreadableStaging(dir, staging);
        const result = await upgrade(dir, content);
        assertEquals(result.status, status);
        assert("refusals" in result);
        assertEquals(result.refusals.length, 1, result.refusals.join("\n"));
        assertStringIncludes(result.refusals[0], ".specnaut/upgrade-staging/");
        assertStringIncludes(result.refusals[0], "locked");
        assertEquals((await new FsLockStore().read(dir))?.templatesVersion, VERSION);
        assertEquals(await Deno.readTextFile(join(staging, "stale.md")), "old upstream\n");
        assertEquals(await Deno.readTextFile(join(dir, DEST)), content);
      } finally {
        // Restored for the cleanup; absent only when the setup failed before it.
        await Deno.chmod(join(staging, "locked"), 0o755).catch((err) => {
          if (!(err instanceof Deno.errors.NotFound)) throw err;
        });
        await Deno.remove(dir, { recursive: true });
      }
    },
  });
}
