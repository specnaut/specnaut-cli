import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  execLockRefusal,
  guardToolCall,
  type RealLog,
} from "../../src/application/review_guard.ts";
import type { ReviewLock } from "../../src/application/review_ports.ts";
import { type LockedReview, UNKNOWN_REVIEW } from "../../src/domain/review_lock.ts";

const SHA = "a".repeat(40);
const REVIEW: LockedReview = { head: SHA, logs: "/real/logs" };

/** A lock held by the sessions in `locked`, each recording `REVIEW`; what it was asked, in `asked`. */
function lock(locked: readonly (string | null)[], asked: (string | null)[] = []): ReviewLock {
  return {
    lock: () => Promise.reject(new Error("the guard never locks")),
    record: () => Promise.reject(new Error("the guard never records")),
    held: (id) =>
      Promise.resolve(void asked.push(id)).then(() => locked.includes(id) ? REVIEW : null),
    all: () => Promise.resolve(locked.map(() => REVIEW)),
  };
}

/** `/logs/<name>` resolves to `/real/logs/<name>`; anything else to nowhere. Each ask, in `asked`. */
function resolver(asked: string[] = []): RealLog {
  return (path) => {
    asked.push(path);
    return Promise.resolve(path.startsWith("/logs/") ? `/real${path}` : null);
  };
}

const PUSH = { sessionId: "s-1", tool: "Bash", input: { command: "git push" } };
const exec = (log: string) => ({
  ...PUSH,
  input: { command: `specnaut sandbox exec ${SHA} --log ${log} -- make` },
});

Deno.test("a session the review lock does not hold runs every tool call", async () => {
  assertEquals(await guardToolCall(lock(["other"]), PUSH, resolver()), { kind: "allowed" });
  const outside = await guardToolCall(null, PUSH, resolver());
  assertEquals(outside, { kind: "allowed" }, "outside a repository");
});

Deno.test("a session the review lock holds runs only what the lock allows", async () => {
  const asked: (string | null)[] = [];
  const outcome = await guardToolCall(lock(["s-1"], asked), PUSH, resolver());
  assertEquals(outcome.kind, "refused");
  assertStringIncludes((outcome as { why: string }).why, "git push");
  const read = { ...PUSH, tool: "Read", input: { file_path: "/x" } };
  assertEquals(await guardToolCall(lock(["s-1"]), read, resolver()), { kind: "allowed" });
  assertEquals(asked, ["s-1"]);
});

Deno.test("a sandboxed run's log is judged by where it resolves, never by its spelling", async () => {
  const asked: string[] = [];
  const held = lock(["s-1"]);
  assertEquals(await guardToolCall(held, exec("/logs/1.log"), resolver(asked)), {
    kind: "allowed",
  });
  const elsewhere = await guardToolCall(held, exec("/real/logs/../x.log"), resolver(asked));
  assertEquals(elsewhere.kind, "refused", "spelt inside, resolving nowhere");
  assertEquals(asked, ["/logs/1.log", "/real/logs/../x.log"]);
  await guardToolCall(held, PUSH, resolver(asked));
  assertEquals(asked.length, 2, "no log is resolved for a call naming none");
});

Deno.test("an input naming no session, or one that is not an id, is judged by any lock", async () => {
  for (const sessionId of [null, "", "../s-1", "s 1"]) {
    const asked: (string | null)[] = [];
    const outcome = await guardToolCall(lock([null], asked), { ...PUSH, sessionId }, resolver());
    assertEquals(outcome.kind, "refused", String(sessionId));
    assertEquals(asked, [null]);
  }
});

Deno.test("a lock that cannot be read refuses the call, naming why", async () => {
  const broken: ReviewLock = {
    ...lock([]),
    held: () => Promise.reject(new Error("permission denied")),
  };
  const read = { ...PUSH, tool: "Read", input: {} };
  const outcome = await guardToolCall(broken, read, resolver());
  assertEquals(outcome.kind, "refused");
  assertStringIncludes((outcome as { why: string }).why, "permission denied");
});

Deno.test("sandbox exec under a lock of its checkout logs only where a review's folder is", async () => {
  const run = (toolchain: string[], log: string | null) => ({ toolchain, log });
  assertEquals(await execLockRefusal(null, run(["/opt"], null), null), null);
  assertEquals(await execLockRefusal(lock([]), run(["/opt"], "/x"), null), null);
  assertEquals(await execLockRefusal(lock(["s-1"]), run([], "/real/logs/1.log"), null), null);
  const refused = [run([], "/elsewhere/1.log"), run([], null), run(["/opt"], "/real/logs/1.log")];
  for (const request of refused) {
    const why = await execLockRefusal(lock(["s-1"]), request, null);
    assertStringIncludes(why ?? "ran", "review lock", JSON.stringify(request));
  }
  const unknown: ReviewLock = { ...lock([]), all: () => Promise.resolve([UNKNOWN_REVIEW]) };
  const why = await execLockRefusal(unknown, run([], "/real/logs/1.log"), null);
  assertStringIncludes(why ?? "ran", "review lock", "a lock naming no folder");
});
