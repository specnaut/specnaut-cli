import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { CHECKOUT_REASON } from "../../src/domain/checkout_trust.ts";
import { SESSION_REASON } from "../../src/domain/session_record.ts";
import { REFTABLE } from "../../src/infrastructure/fs_head_reflog.ts";
import { check, reasons, setUp, startSession } from "./verify_checkout_fixture.ts";
import { git } from "./verify_scripts_fixture.ts";

/**
 * The checkout check reads HEAD's reflog against where it stood when the session started: the
 * file must still begin with the bytes it held then, and every commit an entry written since names
 * must be the base tip's, so a branch checked out and left again is still seen.
 */

const rewritten = [{ path: "HEAD", reason: SESSION_REASON.reflogRewritten }];
const logsHead = async (root: string) =>
  join((await git(root, "rev-parse", "--absolute-git-dir")).trim(), "logs", "HEAD");

Deno.test("a branch checked out and left after the session started fails, by HEAD's reflog", async () => {
  const { root, head } = await setUp();
  await git(root, "checkout", "-q", "outside");
  assertEquals(
    reasons(await check(root, head)),
    [{ path: head, reason: CHECKOUT_REASON.headHolds }],
    "each cause once while HEAD is still there",
  );
  await git(root, "checkout", "-q", "feature");
  assertEquals(reasons(await check(root, head)), [{ path: head, reason: SESSION_REASON.visited }]);
});

Deno.test("a branch visit whose own entry was deleted is still seen, by the entry after it", async () => {
  const { root, head } = await setUp();
  await git(root, "checkout", "-q", "outside");
  await git(root, "checkout", "-q", "feature");
  await git(root, "reflog", "delete", "HEAD@{1}"); // the move to `outside`
  assertEquals(reasons(await check(root, head)), [{ path: head, reason: SESSION_REASON.visited }]);
});

Deno.test("a reflog whose entries before the start were removed fails, whatever it holds since", async () => {
  const { root, head } = await setUp();
  const entries = (await git(root, "rev-list", "-g", "HEAD")).trim().split("\n").length;
  for (const oldest of [entries - 1, entries - 2]) {
    await git(root, "reflog", "delete", `HEAD@{${oldest}}`);
  }
  await git(root, "checkout", "-q", "outside");
  await git(root, "checkout", "-q", "feature");
  assertEquals(reasons(await check(root, head)), rewritten);
});

Deno.test("a reflog without the entry the session started at fails", async () => {
  const { root, head } = await setUp();
  await git(root, "checkout", "-q", "--detach");
  await startSession(root);
  await git(root, "checkout", "-q", "feature");
  await git(root, "reflog", "delete", "HEAD@{1}"); // the newest entry when the session started
  assertEquals(reasons(await check(root, head)), rewritten);
});

Deno.test("a reflog removed since the session started fails", async () => {
  const { root, head } = await setUp();
  await Deno.remove(await logsHead(root));
  assertEquals(reasons(await check(root, head)), rewritten);
});

Deno.test("a reflog git expired since the session started fails, saying git expired it", async () => {
  const { root, head } = await setUp();
  assertEquals((await check(root, head)).kind, "trusted", "a clean session");
  await git(root, "reflog", "expire", "--expire=now", "--all");
  const found = reasons(await check(root, head));
  assertEquals(found, rewritten);
  for (const why of ["git gc", "git reflog expire", "start a new session"]) {
    assertStringIncludes(found[0].reason, why);
  }
});

Deno.test("a reflog over the size cap fails, as a reason, never an uncaught error", async () => {
  const { root, head } = await setUp();
  await Deno.truncate(await logsHead(root), 33 * 1024 * 1024);
  const [found] = reasons(await check(root, head));
  assertEquals(found.path, "HEAD");
  assertStringIncludes(found.reason, `${SESSION_REASON.reflogUnreadable}: `);
  assertStringIncludes(found.reason, "bytes");
});

Deno.test({
  name: "a reflog that is a link fails, as a reason, never read through",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const { root, head } = await setUp();
    const path = await logsHead(root);
    const elsewhere = join(root, "..", "reflog");
    await Deno.rename(path, elsewhere);
    await Deno.symlink(elsewhere, path);
    const [found] = reasons(await check(root, head));
    assertEquals(found.path, "HEAD");
    assertStringIncludes(found.reason, `${SESSION_REASON.reflogUnreadable}: `);
    assertStringIncludes(found.reason, "a link is not followed");
  },
});

/** Whether this git moves a repository's refs, reflogs included, to a reftable: git 2.48's. */
const MIGRATES = await (async () => {
  const out = await new Deno.Command("git", { args: ["version"], stdout: "piped" }).output();
  const [major, minor] = (/(\d+)\.(\d+)/.exec(new TextDecoder().decode(out.stdout)) ?? [])
    .slice(1).map(Number);
  return major > 2 || (major === 2 && minor >= 48);
})();

Deno.test({
  name: "a repository whose refs are in a reftable takes no record, and the check says why",
  ignore: !MIGRATES,
  fn: async () => {
    const { root, head } = await setUp();
    await git(root, "refs", "migrate", "--ref-format=reftable");
    const why = { path: "HEAD", reason: `${SESSION_REASON.reflogUnreadable}: ${REFTABLE}` };
    assertEquals(reasons(await check(root, head)), [why], "a session started before the move");
    await assertRejects(() => startSession(root, "startup", "fixture-reftable"), Error, REFTABLE);
    assertEquals(reasons(await check(root, head, { id: "fixture-reftable" })), [
      { path: SESSION_REASON.path, reason: SESSION_REASON.missing },
      why,
    ]);
  },
});
