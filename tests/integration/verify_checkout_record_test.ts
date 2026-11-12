import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { CHECKOUT_REASON, restartAdvice } from "../../src/domain/checkout_trust.ts";
import { REASON } from "../../src/domain/script_trust.ts";
import { SESSION_REASON } from "../../src/domain/session_record.ts";
import { check, reasons, SETTINGS, setUp, startSession } from "./verify_checkout_fixture.ts";
import { commitAll, git, write } from "./verify_scripts_fixture.ts";

/**
 * The checkout check judges the record its session's start took as well as the folder as it is:
 * the harness loaded the checkout then. A session without a readable record of its own is refused,
 * never judged on the folder alone.
 */

const atStart = (reason: string) => `${SESSION_REASON.atStart}: ${reason}`;
const RECORD = SESSION_REASON.path;

/** A session started on `outside`, which also changes the harness settings; its two commits. */
async function startedOnTheBranch(root: string) {
  await git(root, "checkout", "-q", "outside");
  await write(root, { [SETTINGS]: '{"hooks":{}}\n' });
  await commitAll(root, "outside settings");
  const head = (await git(root, "rev-parse", "HEAD")).trim();
  const first = (await git(root, "rev-parse", "HEAD~1")).trim();
  const record = await startSession(root, "startup", "fixture-session-branch");
  return { head, first, record };
}

Deno.test("a checkout switched to the base after its session started on the branch fails, by the record", async () => {
  const { root } = await setUp();
  const { head, first } = await startedOnTheBranch(root);
  await git(root, "checkout", "-q", "feature");
  const outcome = await check(root, head);
  assertEquals(reasons(outcome), [
    { path: head, reason: atStart(CHECKOUT_REASON.headHolds) },
    { path: first, reason: atStart(CHECKOUT_REASON.headHolds) },
    { path: SETTINGS, reason: atStart(REASON.differs) },
  ]);
  const tip = (await git(root, "rev-parse", "main")).trim();
  if (outcome.kind === "restart") assertEquals(outcome.advice, restartAdvice(tip));
  await startSession(root);
  assertEquals((await check(root, head)).kind, "trusted", "a session started on the base holds");
});

Deno.test("a session started on the branch and resumed on the base keeps its first record, and fails", async () => {
  const { root } = await setUp();
  const { head } = await startedOnTheBranch(root);
  await git(root, "checkout", "-q", "feature");
  await startSession(root, "resume", "fixture-session-branch");
  const found = reasons(await check(root, head));
  assertEquals(found.at(-1), { path: SETTINGS, reason: atStart(REASON.differs) });
});

Deno.test({
  name: "a record read through a linked record folder is refused, as the writer refuses one",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const { root, head } = await setUp();
    const own = await startSession(root);
    const specnaut = join(root, ".git", "specnaut");
    const elsewhere = join(root, "..", "elsewhere");
    await Deno.rename(specnaut, elsewhere);
    await Deno.symlink(elsewhere, specnaut);
    assertEquals(reasons(await check(root, head, { named: own })), [{
      path: RECORD,
      reason: `${SESSION_REASON.unreadable}: ${specnaut} is not a folder`,
    }]);
  },
});

Deno.test("a session still on the branch is told each cause once, as the checkout shows it now", async () => {
  const { root } = await setUp();
  const { head, first } = await startedOnTheBranch(root);
  assertEquals(reasons(await check(root, head)), [
    { path: head, reason: CHECKOUT_REASON.headHolds },
    { path: first, reason: CHECKOUT_REASON.headHolds },
    { path: SETTINGS, reason: REASON.differs },
  ]);
});

Deno.test("a session naming no record is refused, told what drops it and to restart, before the checkout is judged", async () => {
  const { root, head } = await setUp();
  // Codex, Copilot, Cursor, OpenCode and Antigravity register no SessionStart record: the variable
  // is never set there, and a Claude Code `/clear` may drop it. The checkout itself is clean, so
  // only the missing record can refuse it.
  for (const named of [undefined, ""]) {
    const outcome = await check(root, head, { named });
    assertEquals(reasons(outcome), [{ path: RECORD, reason: SESSION_REASON.none }]);
    for (const told of ["no session-start record", "`/clear`", "start a new session"]) {
      assertStringIncludes(SESSION_REASON.none, told);
    }
    const tip = (await git(root, "rev-parse", "main")).trim();
    if (outcome.kind === "restart") assertEquals(outcome.advice, restartAdvice(tip));
  }
});

Deno.test("a record named outside this checkout's record folder is refused, never read", async () => {
  const { root, head } = await setUp();
  const own = await startSession(root);
  const folder = join(root, ".git", "specnaut", "session");
  const elsewhere = [
    join(root, "fixture-session.json"),
    join(root, ".git", "specnaut", "fixture-session.json"),
    // Spelled past the folder and back: never resolved, since `x/..` past a link leads elsewhere.
    `${folder}/x/../fixture-session.json`,
    `${folder}/../session/fixture-session.json`,
    `${folder}//fixture-session.json`,
    "fixture-session.json",
    `${own}.bak`,
    join(folder, ".fixture-session.json"),
  ];
  await Deno.copyFile(own, join(root, "fixture-session.json"));
  for (const named of elsewhere) {
    assertEquals(
      reasons(await check(root, head, { named })),
      [{ path: RECORD, reason: `${SESSION_REASON.outside}: ${named}` }],
      named,
    );
  }
});

Deno.test("a record that is missing, not a file, or not a record is refused", async () => {
  const { root, head } = await setUp();
  const own = await startSession(root);
  const other = join(root, ".git", "specnaut", "session", "another-session.json");
  assertEquals(reasons(await check(root, head, { named: other })), [{
    path: RECORD,
    reason: SESSION_REASON.missing,
  }]);
  for (const told of ["unused for 30 days is removed", "start a new session"]) {
    assertStringIncludes(SESSION_REASON.missing, told);
  }
  await Deno.mkdir(other);
  assertEquals(reasons(await check(root, head, { named: other })), [{
    path: RECORD,
    reason: `${SESSION_REASON.unreadable}: not a regular file`,
  }]);
  await Deno.writeTextFile(own, "{not json");
  const [garbled] = reasons(await check(root, head));
  assertEquals(garbled.path, RECORD);
  assertStringIncludes(garbled.reason, `${SESSION_REASON.malformed}: not JSON`);
  await Deno.writeTextFile(own, JSON.stringify({ version: 3, head: "HEAD", tree: [] }));
  assertEquals(reasons(await check(root, head)), [{
    path: RECORD,
    reason: `${SESSION_REASON.malformed}: not a version 3 record`,
  }]);
  const earlier = {
    version: 2,
    head: "c".repeat(40),
    reflog: { entries: 3, newest: "c" },
    tree: [],
  };
  await Deno.writeTextFile(own, JSON.stringify(earlier));
  assertEquals(reasons(await check(root, head)), [{
    path: RECORD,
    reason: `${SESSION_REASON.malformed}: a version 2 record, where this specnaut reads ` +
      "version 3: start a new session",
  }]);
});

Deno.test("a record whose HEAD this repository does not have is refused", async () => {
  const { root, head } = await setUp();
  const own = await startSession(root);
  const record = JSON.parse(await Deno.readTextFile(own));
  const gone = "e".repeat(40);
  await Deno.writeTextFile(own, JSON.stringify({ ...record, head: gone }));
  assertEquals(reasons(await check(root, head)), [{
    path: gone,
    reason: atStart(SESSION_REASON.headUnknown),
  }]);
});
