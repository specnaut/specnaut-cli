import { assert, assertEquals } from "@std/assert";
import { UpgradeProjectUseCase } from "../../src/application/upgrade_project.ts";
import { sha256Hex } from "../../src/domain/sha256.ts";
import type { InstalledLock, LockEntry } from "../../src/domain/installed_lock.ts";
import {
  coreFromBundle,
  fakeHarness,
  fakeLockStore,
  fakeReader,
  fakeStagingStore,
  fakeWriter,
} from "./upgrade_fakes.ts";

/**
 * What `upgrade` does with an orphan — a lock entry the bundle no longer
 * carries: which it may delete (cli#665), and how a customised one it keeps
 * stays reachable (cli#666). The fake harness manages `.claude/skills/`.
 */

const ROOT = ".claude/skills/";
const findHarness = (key: string) => key === "claude" ? fakeHarness([ROOT]) : null;

/** A lock at 0.6.1 carrying `a.md` plus the given orphan rows, each recorded with `sha`. */
async function lockWithOrphans(orphans: Record<string, string>): Promise<InstalledLock> {
  const entry = async (content: string): Promise<LockEntry> => ({
    sha256: await sha256Hex(content),
    installedAt: "2026-04-25T00:00:00Z",
    templatesVersion: "0.6.1",
  });
  const entries = new Map<string, LockEntry>([["a.md", await entry("alpha")]]);
  for (const [dest, recorded] of Object.entries(orphans)) entries.set(dest, await entry(recorded));
  return {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "0.6.1",
    entries,
  };
}

/** One upgrade run against a shared lock store, on a disk the writer never mutates. */
async function upgrade(
  lockStore: ReturnType<typeof fakeLockStore>,
  disk: Record<string, string>,
  force: boolean,
  links: Record<string, string> = {},
) {
  const writer = fakeWriter(links);
  const uc = new UpgradeProjectUseCase({
    stagingStore: fakeStagingStore(),
    reader: fakeReader({ "a.md": "alpha", ...disk }),
    writer,
    lockStore,
    core: coreFromBundle({ "a.md": { content: "alpha", executable: false } }),
    templatesVersion: "0.7.0",
    findHarness,
  });
  const result = await uc.execute({ projectDir: "/p", dryRun: false, force });
  assert(result.status === "applied", `expected an applied run, got ${result.status}`);
  return { result, writer };
}

Deno.test("a clean orphan under a managed root is deleted without a backup and untracked", async () => {
  const orphan = `${ROOT}old/SKILL.md`;
  const lockStore = fakeLockStore(await lockWithOrphans({ [orphan]: "old\n" }));
  const { writer } = await upgrade(lockStore, { [orphan]: "old\n" }, false);
  assertEquals(writer.deleted, [orphan]);
  assertEquals(writer.deleteBackupsRequested, false);
  assertEquals(lockStore.last?.entries.has(orphan), false);
});

Deno.test("what the writer reports about a delete reaches the run's output", async () => {
  // A folder the writer could not tidy is reported, never swallowed — and only
  // if the use case passes the writer's notes on.
  const orphan = `${ROOT}old/SKILL.md`;
  const lockStore = fakeLockStore(await lockWithOrphans({ [orphan]: "old\n" }));
  const { result } = await upgrade(lockStore, { [orphan]: "old\n" }, false);
  assertEquals(result.refusals, [`note: tidied after ${orphan}`]);
});

Deno.test("a customised orphan stays tracked until --force removes it (cli#666)", async () => {
  const orphan = `${ROOT}old/SKILL.md`;
  const original = await lockWithOrphans({ [orphan]: "original" });
  const recorded = original.entries.get(orphan)!;
  const lockStore = fakeLockStore(original);
  const disk = { [orphan]: "user-edited" };

  // Two plain runs: kept, reported each time, and the entry survives both with
  // the sha it was installed with — not the user's, which would turn the next
  // verdict into a silent `remove` of their edit.
  for (const run of [1, 2]) {
    const { result, writer } = await upgrade(lockStore, disk, false);
    assertEquals(writer.deleted, [], `run ${run} deleted the kept orphan`);
    assertEquals(lockStore.writes, run, `run ${run} did not rewrite the lock`);
    const kept = result.status === "applied" ? result.plan.find((a) => a.dest === orphan) : null;
    assertEquals(kept, {
      kind: "remove",
      dest: orphan,
      oldSha: recorded.sha256,
      wasCustomized: true,
    });
    assertEquals(
      lockStore.last?.entries.get(orphan),
      recorded,
      `run ${run} lost or rewrote the entry`,
    );
  }

  const { writer } = await upgrade(lockStore, disk, true);
  assertEquals(writer.deleted, [orphan]);
  assertEquals(writer.deleteBackupsRequested, true);
  assertEquals(lockStore.writes, 3);
  assertEquals(lockStore.last?.entries.has(orphan), false);
});

Deno.test("an orphan under .git/ is refused, even with --force (cli#665)", async () => {
  for (const force of [false, true]) {
    // A fresh lock each time: the first run drops the entry, which would leave
    // the `--force` run with nothing to refuse.
    const lockStore = fakeLockStore(await lockWithOrphans({ ".git/config": "[core]\n" }));
    const { result, writer } = await upgrade(lockStore, { ".git/config": "[core]\n" }, force);
    assertEquals(writer.deleted, [], `force=${force} deleted .git/config`);
    assertEquals(
      result.status === "applied" ? result.plan.find((a) => a.dest === ".git/config") : null,
      { kind: "orphan-refused", dest: ".git/config", reason: "git-dir", onDisk: true },
    );
    assertEquals(lockStore.last?.entries.has(".git/config"), false);
  }
});

Deno.test("an orphan outside every managed root is reported, untracked and left (cli#665)", async () => {
  const foreign = {
    "src/app.ts": "code",
    ".specnaut/specs/001/plan.md": "plan",
    [`${ROOT}../../src/b.ts`]: "b",
    ".claude/settings.local.json": "{}",
  };
  const lockStore = fakeLockStore(await lockWithOrphans(foreign));
  const { result, writer } = await upgrade(lockStore, foreign, true);
  assertEquals(writer.deleted, []);
  const refused = result.status === "applied"
    ? result.plan.filter((a) => a.kind === "orphan-refused").map((a) => a.dest)
    : [];
  assertEquals(refused, Object.keys(foreign).sort());
  for (const dest of Object.keys(foreign)) assertEquals(lockStore.last?.entries.has(dest), false);
});

Deno.test("an in-scope orphan that resolves outside through a symlink is left in place (cli#665)", async () => {
  // `.claude/skills/s` is a committed link to `src/`: the text is in scope, the
  // file it reaches is not. The writer is the one that can see the link.
  const viaLink = `${ROOT}s/app.ts`;
  const lockStore = fakeLockStore(await lockWithOrphans({ [viaLink]: "code" }));
  const { result, writer } = await upgrade(lockStore, { [viaLink]: "code" }, false, {
    [viaLink]: "src/app.ts",
  });
  assertEquals(writer.deleted, []);
  // Reported as what happened — refused, not "removed" as the plan expected.
  assertEquals(
    result.status === "applied" ? result.plan.find((a) => a.dest === viaLink) : null,
    { kind: "orphan-refused", dest: viaLink, reason: "outside-managed-roots", onDisk: true },
  );
  assertEquals(lockStore.last?.entries.has(viaLink), false);
});
