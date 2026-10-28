import { assertEquals } from "@std/assert";
import {
  keptOrphanEntries,
  orphanScope,
  planOrphans,
  SHARED_ROOTS,
} from "../../src/domain/orphan_scope.ts";
import type { InstalledLock, LockEntry } from "../../src/domain/installed_lock.ts";
import type { UpgradePlan } from "../../src/domain/upgrade_plan.ts";

const ROOTS = [".claude/skills/"];

Deno.test("orphanScope: the shared roots and the declared roots are in scope, nothing else", () => {
  for (const root of SHARED_ROOTS) assertEquals(orphanScope(`${root}x.md`, ROOTS), "in-scope");
  assertEquals(orphanScope(".claude/skills/old/SKILL.md", ROOTS), "in-scope");
  // Files directly in `.specnaut/` are Specnaut's own; what a release retires there must go.
  assertEquals(orphanScope(".specnaut/harness-tools.md", ROOTS), "in-scope");
  // The project's own content under `.specnaut/` and beside the harness folders.
  for (
    const dest of [
      ".specnaut/specs/001/plan.md",
      ".specnaut/backlog/012-task.md",
      ".specnaut/addenda/specnaut/plan.md",
      ".specnaut/preserve.yml",
      ".specnaut/backlog-config.yml",
      ".specnaut/installed.lock",
      ".claude/settings.local.json",
      "src/app.ts",
      "README.md",
    ]
  ) assertEquals(orphanScope(dest, ROOTS), "outside-managed-roots", dest);
  // A root is a folder, not a file under itself; a sibling sharing the prefix is not under it.
  assertEquals(orphanScope(".claude/skills/", ROOTS), "outside-managed-roots");
  assertEquals(orphanScope(".claude/skillsx/a.md", ROOTS), "outside-managed-roots");
});

Deno.test("orphanScope: no declared roots means the shared roots only — it fails closed", () => {
  assertEquals(orphanScope(".claude/skills/old/SKILL.md"), "outside-managed-roots");
  assertEquals(orphanScope(".specnaut/scripts/bash/x.sh"), "in-scope");
});

Deno.test("orphanScope: a .git segment is refused whatever the roots say, as Windows reads it", () => {
  assertEquals(orphanScope(".git/config", [".git/"]), "git-dir");
  assertEquals(orphanScope(".claude/skills/.git/HEAD", ROOTS), "git-dir");
  assertEquals(orphanScope(".GIT/hooks/pre-commit", ROOTS), "git-dir");
  // Windows drops trailing dots and spaces: both of these open `.git`.
  assertEquals(orphanScope(".claude/skills/.git./config", ROOTS), "git-dir");
  assertEquals(orphanScope(".claude/skills/.git /config", ROOTS), "git-dir");
  // The 8.3 short name Windows gives `.git`, and a name HFS+ reads as `.git`.
  assertEquals(orphanScope(".claude/skills/GIT~1/config", ROOTS), "git-dir");
  assertEquals(orphanScope(".claude/skills/.g\u200bit/config", ROOTS), "git-dir");
  // `.github/` is not `.git/`.
  assertEquals(orphanScope(".github/instructions/a.md", [".github/instructions/"]), "in-scope");
});

Deno.test("orphanScope: a path that is not plainly relative is never in scope", () => {
  // Each passes a naive prefix test.
  for (
    const dest of [
      ".claude/skills/../../src/app.ts",
      ".claude/skills/./a.md",
      ".claude/skills//a.md",
      ".claude/skills/..\\..\\src\\app.ts",
      ".claude/skills/a.md:stream", // an NTFS alternate data stream
      ".claude/skills/a.md.", // Windows opens `a.md`
    ]
  ) assertEquals(orphanScope(dest, ROOTS), "outside-managed-roots", dest);
});

const entry = (sha: string): LockEntry => ({
  sha256: sha,
  installedAt: "2026-04-25T00:00:00Z",
  templatesVersion: "0.1.0",
});
const lockOf = (rows: Record<string, string>): InstalledLock => ({
  version: 2,
  harness: "claude",
  backlogBackend: "local",
  versionScheme: "semver",
  specBackend: "local",
  templatesVersion: "0.1.0",
  entries: new Map(Object.entries(rows).map(([d, sha]) => [d, entry(sha)])),
});

Deno.test("planOrphans: scope is decided first — before the disk, before a declaration", () => {
  const lock = lockOf({
    ".claude/skills/old.md": "s",
    ".git/hooks/pre-push": "s",
    "src/gone.ts": "s",
    "src/declared.ts": "s",
  });
  const disk = new Map([[".claude/skills/old.md", "s"], [".git/hooks/pre-push", "s"], [
    "src/declared.ts",
    "s",
  ]]);
  const plan = planOrphans(disk, lock, new Map(), {
    managedRoots: ROOTS,
    // A declaration keeps a file; it cannot put a foreign path back in scope.
    isDeclaredPreserved: (d) => d === "src/declared.ts",
    pluginAvailable: () => false,
  });
  assertEquals(plan, [
    { kind: "remove", dest: ".claude/skills/old.md", oldSha: "s", wasCustomized: false },
    { kind: "orphan-refused", dest: ".git/hooks/pre-push", reason: "git-dir", onDisk: true },
    {
      kind: "orphan-refused",
      dest: "src/declared.ts",
      reason: "outside-managed-roots",
      onDisk: true,
    },
    // Absent from disk and refused all the same: a lock naming a foreign path
    // is reported even when there is nothing left to protect.
    { kind: "orphan-refused", dest: "src/gone.ts", reason: "outside-managed-roots", onDisk: false },
  ]);
});

Deno.test("keptOrphanEntries: carries a kept customised orphan verbatim, and nothing under --force", () => {
  const lock = lockOf({ "a/kept.md": "k", "a/clean.md": "c", "src/x.ts": "x" });
  const plan: UpgradePlan = [
    { kind: "remove", dest: "a/kept.md", oldSha: "k", wasCustomized: true },
    { kind: "remove", dest: "a/clean.md", oldSha: "c", wasCustomized: false },
    { kind: "orphan-refused", dest: "src/x.ts", reason: "outside-managed-roots", onDisk: true },
  ];
  assertEquals([...keptOrphanEntries(plan, lock, false)], [["a/kept.md", entry("k")]]);
  assertEquals(keptOrphanEntries(plan, lock, true).size, 0);
});

Deno.test("keptOrphanEntries: carries a declared orphan the bundle dropped, --force or not (cli#668)", () => {
  const lock = lockOf({ "a/declared.md": "d", "a/current.md": "c" });
  const plan: UpgradePlan = [
    {
      kind: "preserve",
      dest: "a/declared.md",
      reason: "declared",
      pluginAvailable: false,
      declaredDrift: "dropped-upstream",
    },
    // A declared path the bundle still ships is rebuilt from the bundle, not carried.
    {
      kind: "preserve",
      dest: "a/current.md",
      reason: "declared",
      pluginAvailable: false,
      declaredDrift: "current",
    },
  ];
  for (const force of [false, true]) {
    assertEquals([...keptOrphanEntries(plan, lock, force)], [["a/declared.md", entry("d")]]);
  }
});

Deno.test("orphanScope: a managed file is in scope by its exact name only (cli#681)", () => {
  // `.codex/` holds the user's own `config.toml`: a retired file there is
  // admitted by name, never by its folder.
  const files = [".codex/goal.md"];
  assertEquals(orphanScope(".codex/goal.md", [], files), "in-scope");
  assertEquals(orphanScope(".codex/config.toml", [], files), "outside-managed-roots");
  assertEquals(orphanScope(".codex/goal.md.bak", [], files), "outside-managed-roots");
  assertEquals(orphanScope(".codex/goal.md", []), "outside-managed-roots");
});
