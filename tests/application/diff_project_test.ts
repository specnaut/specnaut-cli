import { assert, assertEquals } from "@std/assert";
import { DiffProjectUseCase } from "../../src/application/diff_project.ts";
import type { FsReader, Harness, LockStore } from "../../src/application/ports.ts";
import type { InstalledLock, LockEntry } from "../../src/domain/installed_lock.ts";
import type { CoreBundle } from "../../src/domain/core_bundle.ts";
import { sha256Hex } from "../../src/domain/sha256.ts";

/**
 * Fake harness mirroring the init/upgrade test fakes: project-root suffix → flat
 * dest. Lets the diff use case map a synthetic CORE_BUNDLE without the real
 * harness machinery.
 */
function fakeClaudeHarness(): Harness {
  return {
    key: "claude",
    displayName: "Claude Code (fake)",
    mapBundle: (core) => {
      const out: Record<string, { content: string; executable: boolean }> = {};
      for (const e of core) {
        if (e.category === "project-root" && e.suffix) {
          out[e.suffix] = { content: e.content, executable: e.executable };
        }
      }
      return out;
    },
  };
}

function bundleEntry(dest: string, content: string): CoreBundle[number] {
  return {
    category: "project-root" as const,
    name: "root",
    suffix: dest,
    content,
    executable: false,
  };
}

function fakeLockStore(lock: InstalledLock | null): LockStore {
  return {
    read: () => Promise.resolve(lock),
    write: () => Promise.resolve(),
    lockPath: (d) => `${d}/.specnaut/installed.lock`,
  };
}

/** In-memory reader over a dest→content map; `null` for absent paths. */
function fakeReader(disk: Record<string, string>): FsReader {
  return {
    readText: (_dir, rel) => Promise.resolve(rel in disk ? disk[rel] : null),
  };
}

async function lockWith(
  entries: Record<string, string>,
): Promise<InstalledLock> {
  const map = new Map<string, LockEntry>();
  for (const [dest, content] of Object.entries(entries)) {
    map.set(dest, {
      sha256: await sha256Hex(content),
      installedAt: "2026-06-09T00:00:00.000Z",
      templatesVersion: "1.2.3",
    });
  }
  return {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "1.2.3",
    entries: map,
  };
}

const findHarness = (key: string): Harness | null => key === "claude" ? fakeClaudeHarness() : null;

function makeUseCase(opts: {
  lock: InstalledLock | null;
  disk: Record<string, string>;
  core: CoreBundle;
}): DiffProjectUseCase {
  return new DiffProjectUseCase({
    reader: fakeReader(opts.disk),
    lockStore: fakeLockStore(opts.lock),
    core: opts.core,
    findHarness,
  });
}

Deno.test("DiffProjectUseCase: a customised file is reported as 'differs' with both contents", async () => {
  const dest = ".claude/agents/product-owner.md";
  const bundled = "# bundled\n";
  const onDisk = "# bundled\n# my customisation\n";
  const lock = await lockWith({ [dest]: bundled });
  const uc = makeUseCase({
    lock,
    disk: { [dest]: onDisk },
    core: [bundleEntry(dest, bundled)],
  });
  const { results, fromVersion } = await uc.execute({
    projectDir: "/tmp/p",
    onlyCustomised: false,
    path: null,
  });
  assertEquals(fromVersion, "1.2.3");
  assertEquals(results.length, 1);
  const r = results[0];
  assertEquals(r.kind, "differs");
  if (r.kind === "differs") {
    assertEquals(r.dest, dest);
    assertEquals(r.diskContent, onDisk);
    assertEquals(r.bundledContent, bundled);
  }
});

Deno.test("DiffProjectUseCase: a vanilla file is reported as 'matches'", async () => {
  const dest = "AGENTS.md";
  const content = "# agents\n";
  const lock = await lockWith({ [dest]: content });
  const uc = makeUseCase({
    lock,
    disk: { [dest]: content },
    core: [bundleEntry(dest, content)],
  });
  const { results } = await uc.execute({ projectDir: "/tmp/p", onlyCustomised: false, path: null });
  assertEquals(results.length, 1);
  assertEquals(results[0].kind, "matches");
  assertEquals(results[0].dest, dest);
});

Deno.test("DiffProjectUseCase: a lock-tracked path absent from the new bundle is 'missing' (FR-009)", async () => {
  const dropped = ".claude/agents/old-agent.md";
  const kept = "AGENTS.md";
  const content = "# agents\n";
  const lock = await lockWith({ [dropped]: "# old\n", [kept]: content });
  // The new bundle no longer ships `dropped` — only `kept`.
  const uc = makeUseCase({
    lock,
    disk: { [dropped]: "# old (edited)\n", [kept]: content },
    core: [bundleEntry(kept, content)],
  });
  const { results } = await uc.execute({ projectDir: "/tmp/p", onlyCustomised: false, path: null });
  const missing = results.find((r) => r.dest === dropped);
  assert(missing !== undefined, "dropped path should appear in results");
  assertEquals(missing!.kind, "missing");
});

Deno.test("DiffProjectUseCase: empty project yields empty results", async () => {
  const lock = await lockWith({});
  const uc = makeUseCase({ lock, disk: {}, core: [] });
  const { results } = await uc.execute({ projectDir: "/tmp/p", onlyCustomised: false, path: null });
  assertEquals(results.length, 0);
});

Deno.test("DiffProjectUseCase: no lock yields empty results (nothing tracked)", async () => {
  const uc = makeUseCase({ lock: null, disk: {}, core: [] });
  const { results, fromVersion } = await uc.execute({
    projectDir: "/tmp/p",
    onlyCustomised: false,
    path: null,
  });
  assertEquals(results.length, 0);
  assertEquals(fromVersion, "");
});

Deno.test("DiffProjectUseCase: onlyCustomised restricts to paths whose disk SHA differs from lock SHA", async () => {
  const customised = ".claude/agents/product-owner.md";
  const vanilla = "AGENTS.md";
  const bundledPo = "# po\n";
  const vanillaContent = "# agents\n";
  const lock = await lockWith({ [customised]: bundledPo, [vanilla]: vanillaContent });
  const uc = makeUseCase({
    lock,
    disk: {
      [customised]: "# po\n# edited\n", // disk SHA ≠ lock SHA
      [vanilla]: vanillaContent, // disk SHA == lock SHA
    },
    core: [bundleEntry(customised, bundledPo), bundleEntry(vanilla, vanillaContent)],
  });
  const { results } = await uc.execute({ projectDir: "/tmp/p", onlyCustomised: true, path: null });
  assertEquals(results.length, 1);
  assertEquals(results[0].dest, customised);
});

// Read-only invariant (contract §4): the use case MUST NOT construct or touch an
// FsWriter. We enforce this structurally — DiffProjectDeps has no writer slot —
// and behaviourally by asserting the deps object the use case accepts has no
// writer-shaped member.
Deno.test("DiffProjectUseCase: deps carry no FsWriter (read-only invariant)", async () => {
  const dest = "AGENTS.md";
  const content = "# agents\n";
  const lock = await lockWith({ [dest]: content });
  const deps = {
    reader: fakeReader({ [dest]: content }),
    lockStore: fakeLockStore(lock),
    core: [bundleEntry(dest, content)] as CoreBundle,
    findHarness,
  };
  // Structural assertion: no writer / write-capable port handed to the use case.
  assertEquals("writer" in deps, false);
  for (const v of Object.values(deps)) {
    if (v && typeof v === "object") {
      assertEquals(
        "writeBundle" in v || "deletePaths" in v,
        false,
        "no write-capable adapter may be injected into the diff use case",
      );
    }
  }
  const uc = new DiffProjectUseCase(deps);
  const { results } = await uc.execute({ projectDir: "/tmp/p", onlyCustomised: false, path: null });
  assertEquals(results[0].kind, "matches");
});

// ---- scoping to one managed path (#594) ------------------------------------
//
// The defect these cover: `diff` dropped its positional argument entirely, so a
// typo'd path, a path outside the bundle, and a correct path all produced the
// same whole-project diff and exit 0. The command could not fail, which is what
// let a preserve.yml maintenance walk read a buried answer as "no drift".

Deno.test("DiffProjectUseCase: a path scopes the view to that one entry", async () => {
  const wanted = ".specnaut/scripts/backlog/_config.sh";
  const other = ".claude/CLAUDE.md";
  const lock = await lockWith({ [wanted]: "old\n", [other]: "doc\n" });
  const uc = makeUseCase({
    lock,
    disk: { [wanted]: "old\n", [other]: "doc EDITED\n" },
    core: [bundleEntry(wanted, "new\n"), bundleEntry(other, "doc\n")],
  });

  const { results, pathProblem } = await uc.execute({
    projectDir: "/tmp/p",
    onlyCustomised: false,
    path: wanted,
  });

  assertEquals(pathProblem, null);
  assertEquals(results.length, 1);
  assertEquals(results[0].dest, wanted);
  assertEquals(results[0].kind, "differs");
});

Deno.test("DiffProjectUseCase: a path the lock does not track reports 'not-managed', not silence", async () => {
  const tracked = ".claude/CLAUDE.md";
  const lock = await lockWith({ [tracked]: "doc\n" });
  const uc = makeUseCase({
    lock,
    disk: { [tracked]: "doc EDITED\n" },
    core: [bundleEntry(tracked, "doc\n")],
  });

  const { results, pathProblem, fromVersion } = await uc.execute({
    projectDir: "/tmp/p",
    onlyCustomised: false,
    path: ".specnaut/scripts/backlog/does-not-exist.sh",
  });

  // The whole-project view MUST NOT run as a fallback: the tracked file
  // diverges, so leaking into it would have produced a confident diff for a
  // question about a file that is not managed at all.
  assertEquals(pathProblem, "not-managed");
  assertEquals(results.length, 0);
  assertEquals(fromVersion, "1.2.3");
});

Deno.test("DiffProjectUseCase: a tracked path absent from disk is distinguished from an unknown one", async () => {
  const dest = ".claude/agents/developer.md";
  const lock = await lockWith({ [dest]: "agent\n" });
  const uc = makeUseCase({
    lock,
    disk: {}, // tracked by the lock, deleted on disk
    core: [bundleEntry(dest, "agent\n")],
  });

  const { results, pathProblem } = await uc.execute({
    projectDir: "/tmp/p",
    onlyCustomised: false,
    path: dest,
  });

  assertEquals(pathProblem, "absent-on-disk");
  assertEquals(results.length, 0);
});

Deno.test("DiffProjectUseCase: a scoped path that matches the bundle is clean, not a problem", async () => {
  const dest = ".claude/CLAUDE.md";
  // A second, DIVERGING entry is what makes this assertion mean anything: with
  // a one-entry lock the result is identical whether or not scoping ran.
  const noisy = ".claude/agents/developer.md";
  const lock = await lockWith({ [dest]: "doc\n", [noisy]: "agent\n" });
  const uc = makeUseCase({
    lock,
    disk: { [dest]: "doc\n", [noisy]: "agent EDITED\n" },
    core: [bundleEntry(dest, "doc\n"), bundleEntry(noisy, "agent\n")],
  });

  const { results, pathProblem } = await uc.execute({
    projectDir: "/tmp/p",
    onlyCustomised: false,
    path: dest,
  });

  assertEquals(pathProblem, null);
  assertEquals(results.length, 1);
  assertEquals(results[0].kind, "matches");
});

Deno.test("DiffProjectUseCase: --only-customised composes with a scoped path", async () => {
  const dest = ".claude/CLAUDE.md";
  // On disk == lock SHA ⇒ not customised, so --only-customised filters it out
  // even though the bundle has moved on underneath it. The second entry IS
  // customised, so an empty result proves the scope held rather than the filter
  // having simply emptied a one-entry lock.
  const noisy = ".claude/agents/developer.md";
  const lock = await lockWith({ [dest]: "doc\n", [noisy]: "agent\n" });
  const uc = makeUseCase({
    lock,
    disk: { [dest]: "doc\n", [noisy]: "agent EDITED\n" },
    core: [bundleEntry(dest, "doc UPSTREAM\n"), bundleEntry(noisy, "agent\n")],
  });

  const { results, pathProblem } = await uc.execute({
    projectDir: "/tmp/p",
    onlyCustomised: true,
    path: dest,
  });

  assertEquals(pathProblem, null);
  assertEquals(results.length, 0);
});
