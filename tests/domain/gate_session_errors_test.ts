import { assertRejects } from "@std/assert";
import type { GateClient } from "../../src/domain/cloud/gate_client.ts";
import { GateSession } from "../../src/domain/cloud/gate_session.ts";
import { REMOTE } from "./gate_fixture.ts";

/**
 * Only an answer from Cloud becomes an outcome. An error that is not a GateApiError —
 * a bug, or a refusal made before any request — propagates from every verb, rather
 * than being reported as Cloud being unreachable.
 */

const BUG = new RangeError("not an answer from Cloud");

/** A client that opens a gate, then fails every other call with something Cloud never said. */
const failing = {
  open: () => Promise.resolve({ id: "g1", state: "open" }),
  get: () => Promise.reject(BUG),
  apply: () => Promise.reject(BUG),
  cancel: () => Promise.reject(BUG),
} as unknown as GateClient;

function session(): GateSession {
  return new GateSession({
    projectKey: "ACME",
    client: failing,
    remote: REMOTE,
    token: () => Promise.resolve("tok"),
    now: () => 0,
    sleep: () => Promise.resolve(),
  });
}

const GATE = { id: "g1", state: "answered" } as Parameters<GateSession["apply"]>[0];

Deno.test("a get that fails with no answer from Cloud ends the await with that error", async () => {
  const raise = session().raiseAndAwait({
    projectKey: "ACME",
    type: "clarification",
    title: "t",
    payload: { question: "q" },
  });
  await assertRejects(() => raise, RangeError, BUG.message);
});

Deno.test("an apply that fails with no answer from Cloud rejects with that error", async () => {
  await assertRejects(() => session().apply(GATE), RangeError, BUG.message);
});

Deno.test("a cancel that fails with no answer from Cloud rejects with that error", async () => {
  await assertRejects(() => session().cancel("g1"), RangeError, BUG.message);
});
