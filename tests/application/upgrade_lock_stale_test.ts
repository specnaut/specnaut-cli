import { assertEquals } from "@std/assert";
import { isLockStale } from "../../src/application/upgrade_lock.ts";
import type { InstalledLock, LockEntry } from "../../src/domain/installed_lock.ts";

/**
 * The staleness predicate of the up-to-date branch (#572, #476, FR-007): when
 * every dest already equals the bundle, the lock is rewritten only if it is
 * behind on one of four axes. Each case below is current on three and behind
 * on the fourth, so a predicate that forgets one axis fails exactly one test.
 */

const at = (sha: string, version = "2.0.0"): LockEntry => ({
  sha256: sha,
  installedAt: "2026-01-01T00:00:00Z",
  templatesVersion: version,
});

const lockOf = (
  entries: Array<[string, LockEntry]>,
  opts: { version?: string; parentManaged?: true } = {},
): InstalledLock => ({
  version: 2,
  harness: "claude",
  backlogBackend: "local",
  versionScheme: "semver",
  specBackend: "local",
  templatesVersion: opts.version ?? "2.0.0",
  entries: new Map(entries),
  ...(opts.parentManaged ? { parentManaged: opts.parentManaged } : {}),
});

const wanted = { templatesVersion: "2.0.0", parentManaged: false };
const derived = (entries: Array<[string, LockEntry]>) => new Map(entries);

Deno.test("isLockStale: a lock that already says everything is not stale", () => {
  const lock = lockOf([["a.md", at("A")]]);
  assertEquals(isLockStale(lock, derived([["a.md", at("A")]]), wanted), false);
});

Deno.test("isLockStale: an entry whose sha lags the bundle is stale", () => {
  const lock = lockOf([["a.md", at("OLD")]]);
  assertEquals(isLockStale(lock, derived([["a.md", at("A")]]), wanted), true);
});

Deno.test("isLockStale: an entry whose templatesVersion lags is stale though its sha is current", () => {
  const lock = lockOf([["a.md", at("A", "1.0.0")]]);
  assertEquals(isLockStale(lock, derived([["a.md", at("A")]]), wanted), true);
});

Deno.test("isLockStale: a dest the derived set adds is stale", () => {
  const lock = lockOf([]);
  assertEquals(isLockStale(lock, derived([["a.md", at("A")]]), wanted), true);
});

Deno.test("isLockStale: an orphan row the derived set drops is stale", () => {
  const lock = lockOf([["a.md", at("A")], ["gone.md", at("G")]]);
  assertEquals(isLockStale(lock, derived([["a.md", at("A")]]), wanted), true);
});

Deno.test("isLockStale: a header version behind the binary is stale though every entry is current", () => {
  const lock = lockOf([["a.md", at("A")]], { version: "1.0.0" });
  assertEquals(isLockStale(lock, derived([["a.md", at("A")]]), wanted), true);
});

Deno.test("isLockStale: a parent-managed decision the lock does not record is stale", () => {
  const lock = lockOf([["a.md", at("A")]]);
  const decision = { ...wanted, parentManaged: true };
  assertEquals(isLockStale(lock, derived([["a.md", at("A")]]), decision), true);
});

Deno.test("isLockStale: a recorded decision that was lifted is stale", () => {
  const lock = lockOf([["a.md", at("A")]], { parentManaged: true });
  assertEquals(isLockStale(lock, derived([["a.md", at("A")]]), wanted), true);
});

Deno.test("isLockStale: a parent-managed lock still carrying an agentic row is stale", () => {
  const skill = ".claude/skills/x/SKILL.md";
  const lock = lockOf([["a.md", at("A")], [skill, at("S")]], { parentManaged: true });
  const decision = { ...wanted, parentManaged: true };
  // The derived set still lists the row: the prune happens when the lock is
  // rewritten, so only the agentic axis can call this lock stale.
  const same = derived([["a.md", at("A")], [skill, at("S")]]);
  assertEquals(isLockStale(lock, same, decision), true);
});
