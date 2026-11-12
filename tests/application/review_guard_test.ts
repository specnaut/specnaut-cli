import { assertEquals, assertStringIncludes } from "@std/assert";
import { guardToolCall } from "../../src/application/review_guard.ts";
import type { ReviewLock } from "../../src/application/review_ports.ts";

/** A lock held by the sessions in `locked`; what it was asked, in `asked`. */
function lock(locked: readonly (string | null)[], asked: (string | null)[] = []): ReviewLock {
  return {
    lock: () => Promise.reject(new Error("the guard never locks")),
    holds: (id) => Promise.resolve(void asked.push(id)).then(() => locked.includes(id)),
  };
}

const PUSH = { sessionId: "s-1", tool: "Bash", input: { command: "git push" } };

Deno.test("a session the review lock does not hold runs every tool call", async () => {
  assertEquals(await guardToolCall(lock(["other"]), PUSH), { kind: "allowed" });
  assertEquals(await guardToolCall(null, PUSH), { kind: "allowed" }, "outside a repository");
});

Deno.test("a session the review lock holds runs only what the lock allows", async () => {
  const asked: (string | null)[] = [];
  const outcome = await guardToolCall(lock(["s-1"], asked), PUSH);
  assertEquals(outcome.kind, "refused");
  assertStringIncludes((outcome as { why: string }).why, "git push");
  const read = { ...PUSH, tool: "Read", input: { file_path: "/x" } };
  assertEquals(await guardToolCall(lock(["s-1"]), read), { kind: "allowed" });
  assertEquals(asked, ["s-1"]);
});

Deno.test("an input naming no session, or one that is not an id, is judged by any lock", async () => {
  for (const sessionId of [null, "", "../s-1", "s 1"]) {
    const asked: (string | null)[] = [];
    const outcome = await guardToolCall(lock([null], asked), { ...PUSH, sessionId });
    assertEquals(outcome.kind, "refused", String(sessionId));
    assertEquals(asked, [null]);
  }
});

Deno.test("a lock that cannot be read refuses the call, naming why", async () => {
  const broken: ReviewLock = {
    lock: () => Promise.reject(new Error("unreached")),
    holds: () => Promise.reject(new Error("permission denied")),
  };
  const read = { ...PUSH, tool: "Read", input: {} };
  const outcome = await guardToolCall(broken, read);
  assertEquals(outcome.kind, "refused");
  assertStringIncludes((outcome as { why: string }).why, "permission denied");
});
