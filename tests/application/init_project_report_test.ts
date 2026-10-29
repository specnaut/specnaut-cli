import { assertEquals } from "@std/assert";
import { InitProjectUseCase } from "../../src/application/init_project.ts";
import type { BackupReport, GitAdapter, Harness } from "../../src/application/ports.ts";
import type { CoreBundle } from "../../src/domain/core_bundle.ts";

/**
 * What `init` reports back from the write: the merges' notes and the JSON
 * files they changed. A plugin Specnaut enables runs code once installed, so a
 * brownfield `init` into an existing `.claude/settings.json` must say so as
 * `upgrade` does (#642) — and the Codex trust note keys on `mergedChanged`.
 */

const CORE: CoreBundle = [{
  category: "project-root",
  name: "root",
  suffix: "CLAUDE.md",
  content: "# hi\n",
  executable: false,
}];

const harness: Harness = {
  key: "claude",
  displayName: "Claude Code (fake)",
  mapBundle: (core) =>
    Object.fromEntries(core.map((e) => [e.suffix, { content: e.content, executable: false }])),
};

const git = (init: () => Promise<void> = () => Promise.resolve()): GitAdapter => ({
  isAvailable: () => Promise.resolve(true),
  isInitialized: () => Promise.resolve(false),
  init,
  getRemoteUrl: () => Promise.resolve(null),
});

function useCase(report: BackupReport, adapter: GitAdapter = git()) {
  return new InitProjectUseCase({
    writer: {
      detectConflicts: () => Promise.resolve([]),
      writeBundle: () => Promise.resolve(report),
      deletePaths: () => Promise.resolve({ backups: [], skippedSkipIfExists: [] }),
    },
    git: adapter,
    lockStore: {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      lockPath: (d) => `${d}/.specnaut/installed.lock`,
    },
    harness,
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    core: CORE,
    ensureDir: () => Promise.resolve(),
  });
}

const REPORT: BackupReport = {
  backups: [],
  skippedSkipIfExists: [],
  notes: [".claude/settings.json: enabled acme@acme-marketplace"],
  mergedChanged: [".claude/settings.json"],
};

Deno.test("init: the merges' notes and changed files reach the result", async () => {
  const result = await useCase(REPORT).execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: false,
    dryRun: false,
  });
  if (result.status !== "initialized") throw new Error(result.status);
  assertEquals(result.notes, REPORT.notes);
  assertEquals(result.mergedChanged, REPORT.mergedChanged);
});

Deno.test("init: a dry run merges nothing, so it reports nothing merged", async () => {
  const result = await useCase(REPORT).execute({
    targetDir: "/tmp/demo",
    initGit: false,
    force: false,
    dryRun: true,
  });
  if (result.status !== "initialized") throw new Error(result.status);
  assertEquals([result.notes, result.mergedChanged], [[], []]);
});

Deno.test("init: a failed git init is a warning, not a failed init", async () => {
  const failing = git(() => Promise.reject(new Error("permission denied")));
  const result = await useCase(REPORT, failing).execute({
    targetDir: "/tmp/demo",
    initGit: true,
    force: false,
    dryRun: false,
  });
  if (result.status !== "initialized") throw new Error(result.status);
  assertEquals(result.warnings, ["git init failed — permission denied"]);
});
