import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { VERSION } from "../../src/domain/version.ts";
import { crossesMajorBoundary } from "../../src/domain/major_boundary.ts";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * #481 — end to end: a major-crossing upgrade names the migration guide, a
 * same-major one does not.
 *
 * The predicate is unit-tested; this pins the wiring, which is the half that
 * actually reaches a user. A correct predicate nobody calls prints nothing.
 */

async function runSpecnaut(args: string[], cwd: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

const INIT = ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"];

/**
 * Both fixtures are derived from the binary's own version rather than written
 * down. A hardcoded same-major fixture stays same-major only until the binary
 * reaches the next major — which happens on the day of the major release this
 * test exists to protect, so it fails then, for a reason that has nothing to
 * do with the behaviour under test. Deriving costs two lines and never expires.
 */
const CURRENT_MAJOR = Number(VERSION.split(".")[0]);
const SAME_MAJOR = `${CURRENT_MAJOR}.0.0`;
const PREVIOUS_MAJOR = `${CURRENT_MAJOR - 1}.0.0`;

Deno.test("the fixtures straddle the boundary they claim to", () => {
  // Without this, a bad derivation makes BOTH tests below vacuously pass: two
  // same-major fixtures would print nothing, twice, and agree with each other.
  assert(CURRENT_MAJOR >= 1, `cannot derive a previous major from ${VERSION}`);
  assert(
    crossesMajorBoundary(PREVIOUS_MAJOR, VERSION),
    `${PREVIOUS_MAJOR} must cross into ${VERSION}`,
  );
  assert(
    !crossesMajorBoundary(SAME_MAJOR, VERSION),
    `${SAME_MAJOR} must not cross into ${VERSION}`,
  );
});

/** Rewrites the lock's recorded templates version, faking an older install. */
async function setLockVersion(dir: string, version: string) {
  const path = join(dir, ".specnaut/installed.lock");
  const lock = await Deno.readTextFile(path);
  await Deno.writeTextFile(
    path,
    lock.replace(/^templates_version: .*$/m, `templates_version: ${version}`),
  );
}

async function upgradeFrom(version: string) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-major-pointer-" });
  try {
    assertEquals((await runSpecnaut(INIT, dir)).code, 0);
    await setLockVersion(dir, version);
    // Rewriting the recorded version alone leaves every file byte-identical, so
    // the plan is all-unchanged and `upgrade` short-circuits to "already up to
    // date" before any of this is reached. Remove a managed file so the run has
    // real work, which is also what a genuine 1.x → 2.x upgrade looks like.
    await Deno.remove(join(dir, ".claude/skills/task/phases/tasks.md"));
    const up = await runSpecnaut(["upgrade", "--force"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);
    return up.stdout;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("a major-crossing upgrade names the migration guide", async () => {
  const out = await upgradeFrom(PREVIOUS_MAJOR);
  assert(out.includes("UPGRADING.md"), "the guide's path must appear in the output");
  assert(out.includes("major version"), "and the reason it is being shown");
});

Deno.test("a same-major upgrade says nothing about it", async () => {
  // The quiet half. A pointer on every patch bump is a line people learn to
  // skip, and then it is not there when it matters.
  const out = await upgradeFrom(SAME_MAJOR);
  assert(!out.includes("UPGRADING.md"), "no migration pointer on a routine bump");
});
