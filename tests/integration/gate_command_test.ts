import { assertEquals } from "@std/assert";
import { type GateDeps, type GateIntent, runGate } from "../../src/cli/handlers/gate_handler.ts";
import { GateClient } from "../../src/domain/cloud/gate_client.ts";
import { GateSession } from "../../src/domain/cloud/gate_session.ts";
import type { RemoteMode } from "../../src/domain/cloud/remote_mode.ts";
import type { FetchFn } from "../../src/domain/cloud/cloud_client.ts";

const API = "https://dep.convex.site";
const REMOTE_ON: RemoteMode = { enabled: true, awaitTimeoutMs: 60_000, pollIntervalMs: 5_000 };

function gate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "gate_abc",
    projectKey: "CLOUD",
    type: "decision",
    title: "Which auth?",
    payload: {},
    state: "open",
    answer: null,
    createdBy: "agent:specflow-cli",
    resolvedBy: null,
    createdAt: "2026-06-04T10:00:00Z",
    resolvedAt: null,
    ...over,
  };
}

/** A resolving backend: opens, then answers on the second poll, applies. */
function resolvingFetch(answer: Record<string, unknown>): FetchFn {
  let polls = 0;
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const reply = (status: number, body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    if (method === "POST" && url.endsWith("/api/v1/gates")) return reply(201, { gate: gate() });
    if (method === "GET" && url.includes("/gates?")) {
      polls++;
      const state = polls >= 2 ? "answered" : "open";
      return reply(200, {
        gates: [gate({ state, answer: polls >= 2 ? answer : null })],
        cursor: "",
        hasMore: false,
      });
    }
    if (method === "POST" && url.includes("/apply")) {
      return reply(200, { gate: gate({ state: "applied", answer }) });
    }
    throw new Error(`unexpected ${method} ${url}`);
  }) as FetchFn;
}

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

function capture(): {
  deps: (session: GateSession | null) => GateDeps;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    deps: (session) => ({
      out: (s) => out.push(s),
      err: (s) => err.push(s),
      buildSession: () => Promise.resolve(session),
    }),
  };
}

function sessionWith(fetchFn: FetchFn, remote = REMOTE_ON): GateSession {
  const { now, sleep } = fakeClock();
  return new GateSession({
    projectKey: "CLOUD",
    client: new GateClient(API, fetchFn),
    remote,
    token: () => Promise.resolve("tok"),
    now,
    sleep,
  });
}

const raiseIntent = (over: Partial<GateIntent> = {}): GateIntent => ({
  kind: "gate",
  sub: "raise",
  apiUrl: null,
  type: "decision",
  title: "Which auth?",
  payload: '{"question":"q","options":[{"id":"A","label":"Device flow"}]}',
  task: null,
  id: null,
  ...over,
});

Deno.test("gate raise: open→await→apply prints the answer JSON, exit 0", async () => {
  const cap = capture();
  const session = sessionWith(resolvingFetch({ choiceId: "A" }));
  const code = await runGate(raiseIntent(), cap.deps(session));
  assertEquals(code, 0);
  assertEquals(JSON.parse(cap.out[0]), { choiceId: "A" });
});

Deno.test("gate raise: § I — no Cloud-internal identifier in stdout", async () => {
  const cap = capture();
  const session = sessionWith(resolvingFetch({ text: "use device flow" }));
  await runGate(
    raiseIntent({ type: "clarification", payload: '{"question":"q"}' }),
    cap.deps(session),
  );
  const stdout = cap.out.join("\n");
  for (const forbidden of ["_id", "convex", "ctx", "gateKey", "createdByUserId", "tasks"]) {
    assertEquals(stdout.includes(forbidden), false, `stdout leaked '${forbidden}'`);
  }
});

Deno.test("gate raise: unresolved (timeout) → exit 3", async () => {
  const cap = capture();
  // a backend that never answers
  const neverFetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const reply = (s: number, b: unknown) =>
      Promise.resolve(new Response(JSON.stringify(b), { status: s }));
    if (method === "POST" && url.endsWith("/api/v1/gates")) return reply(201, { gate: gate() });
    if (method === "GET" && url.includes("/gates?")) {
      return reply(200, { gates: [gate()], cursor: "", hasMore: false });
    }
    throw new Error("unexpected");
  }) as FetchFn;
  const session = sessionWith(neverFetch, {
    enabled: true,
    awaitTimeoutMs: 20_000,
    pollIntervalMs: 5_000,
  });
  assertEquals(await runGate(raiseIntent(), cap.deps(session)), 3);
});

Deno.test("gate raise: remote disabled / no creds → exit 5", async () => {
  const cap = capture();
  const session = sessionWith(resolvingFetch({ text: "x" }), {
    enabled: false,
    awaitTimeoutMs: 1,
    pollIntervalMs: 1,
  });
  assertEquals(await runGate(raiseIntent(), cap.deps(session)), 5);
});

Deno.test("gate raise: not Cloud-linked (no session) → exit 5", async () => {
  const cap = capture();
  assertEquals(await runGate(raiseIntent(), cap.deps(null)), 5);
});

Deno.test("gate raise: bad --payload JSON → exit 1, nothing on stdout", async () => {
  const cap = capture();
  const session = sessionWith(resolvingFetch({ text: "x" }));
  const code = await runGate(raiseIntent({ payload: "{not json" }), cap.deps(session));
  assertEquals(code, 1);
  assertEquals(cap.out.length, 0);
});

Deno.test("gate status: remote on → exit 0 + JSON; off → exit 2", async () => {
  const on = capture();
  assertEquals(
    await runGate(
      { ...raiseIntent(), sub: "status" },
      on.deps(sessionWith(resolvingFetch({}), REMOTE_ON)),
    ),
    0,
  );
  assertEquals(JSON.parse(on.out[0]).enabled, true);

  const off = capture();
  const offSession = sessionWith(resolvingFetch({}), {
    enabled: false,
    awaitTimeoutMs: 1,
    pollIntervalMs: 1,
  });
  assertEquals(await runGate({ ...raiseIntent(), sub: "status" }, off.deps(offSession)), 2);
});
