import { assertEquals } from "@std/assert";
import type { TokenProvider } from "../../src/domain/cloud/gate_session.ts";
import type { FetchFn } from "../../src/domain/cloud/cloud_client.ts";
import { Backend, gateObj, session } from "./gate_fixture.ts";

const constToken: TokenProvider = () => Promise.resolve("tok");

Deno.test("raiseAndAwait: open → poll until answered → returns the typed answer (no TTY)", async () => {
  const be = new Backend();
  const s = session(be, constToken);
  // resolve the gate after the second poll
  const orig = be.fetch;
  let polls = 0;
  be.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if ((init?.method ?? "GET").toUpperCase() === "GET" && String(input).includes("/gates?")) {
      polls++;
      if (polls >= 2) {
        be.state = "answered";
        be.answer = { text: "use device flow" };
      }
    }
    return orig(input, init);
  }) as FetchFn;

  const out = await s.raiseAndAwait({
    projectKey: "CLOUD",
    type: "clarification",
    title: "t",
    payload: { question: "q" },
  });
  assertEquals(out.kind, "answered");
  if (out.kind === "answered") assertEquals(out.answer.text, "use device flow");
});

Deno.test("apply is idempotent: applying twice both succeed", async () => {
  const be = new Backend();
  be.state = "answered";
  be.answer = { text: "x" };
  const s = session(be, constToken);
  const g = gateObj(be);
  const first = await s.apply(g);
  assertEquals(first.kind, "applied");
  const second = await s.apply(g); // re-apply is a safe success no-op (SC-002)
  assertEquals(second.kind, "applied");
});

Deno.test("raiseAndAwait: never resolved → unresolved within the timeout (no hang)", async () => {
  const be = new Backend(); // stays open forever
  const s = session(be, constToken, {
    enabled: true,
    awaitTimeoutMs: 30_000,
    pollIntervalMs: 5_000,
  });
  const out = await s.raiseAndAwait({
    projectKey: "CLOUD",
    type: "clarification",
    title: "t",
    payload: { question: "q" },
  });
  assertEquals(out.kind, "unresolved");
});

Deno.test("raiseAndAwait: transient 5xx during poll keeps awaiting, then resolves", async () => {
  const be = new Backend();
  be.failGetTimes = 3; // first three probes 500
  const s = session(be, constToken, {
    enabled: true,
    awaitTimeoutMs: 600_000,
    pollIntervalMs: 5_000,
  });
  // flip to answered after the failures are exhausted
  const orig = be.fetch;
  be.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (
      (init?.method ?? "GET").toUpperCase() === "GET" && be.failGetTimes === 0 &&
      be.state === "open"
    ) {
      be.state = "answered";
      be.answer = { text: "ok" };
    }
    return orig(input, init);
  }) as FetchFn;
  const out = await s.raiseAndAwait({
    projectKey: "CLOUD",
    type: "clarification",
    title: "t",
    payload: { question: "q" },
  });
  assertEquals(out.kind, "answered");
});

Deno.test("raiseAndAwait: token refreshes transparently across expiry (SC-007)", async () => {
  const be = new Backend();
  // token provider 'refreshes': returns tokA first, then tokB once the await is underway.
  let calls = 0;
  const refreshing: TokenProvider = () => {
    calls++;
    return Promise.resolve(calls <= 1 ? "tokA" : "tokB");
  };
  const s = session(be, refreshing);
  let polls = 0;
  const orig = be.fetch;
  be.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if ((init?.method ?? "GET").toUpperCase() === "GET" && String(input).includes("/gates?")) {
      polls++;
      if (polls >= 2) {
        be.state = "answered";
        be.answer = { text: "done" };
      }
    }
    return orig(input, init);
  }) as FetchFn;
  const out = await s.raiseAndAwait({
    projectKey: "CLOUD",
    type: "clarification",
    title: "t",
    payload: { question: "q" },
  });
  assertEquals(out.kind, "answered");
  // later requests used the refreshed token
  assertEquals(be.tokensSeen.includes("tokB"), true);
});

Deno.test("remote disabled → no_remote (caller handles locally)", async () => {
  const be = new Backend();
  const s = session(be, constToken, {
    enabled: false,
    awaitTimeoutMs: 60_000,
    pollIntervalMs: 5_000,
  });
  const out = await s.raiseAndAwait({
    projectKey: "CLOUD",
    type: "clarification",
    title: "t",
    payload: { question: "q" },
  });
  assertEquals(out.kind, "error");
  if (out.kind === "error") assertEquals(out.reason, "no_remote");
});

Deno.test("remote enabled but no credentials → no_remote (prerequisites unmet)", async () => {
  const be = new Backend();
  const noCreds: TokenProvider = () => Promise.resolve(null);
  const s = session(be, noCreds);
  const out = await s.raiseAndAwait({
    projectKey: "CLOUD",
    type: "clarification",
    title: "t",
    payload: { question: "q" },
  });
  assertEquals(out.kind, "error");
  if (out.kind === "error") assertEquals(out.reason, "no_remote");
});

Deno.test("invalid payload is rejected locally before any network call", async () => {
  const be = new Backend();
  const s = session(be, constToken);
  const out = await s.raiseAndAwait({
    projectKey: "CLOUD",
    type: "clarification",
    title: "t",
    payload: {},
  });
  assertEquals(out.kind, "error");
  if (out.kind === "error") assertEquals(out.reason, "invalid");
  assertEquals(be.getCalls, 0);
});

Deno.test("cancel withdraws an open gate", async () => {
  const be = new Backend();
  const s = session(be, constToken);
  const out = await s.cancel("gate_abc");
  assertEquals(out.kind, "cancelled");
});

/** Minimal Gate object for apply() tests (the session only reads .id). */
