import { assertEquals, assertRejects } from "@std/assert";
import { GateApiError, GateClient, reasonForStatus } from "../../src/domain/cloud/gate_client.ts";
import type { FetchFn } from "../../src/domain/cloud/cloud_client.ts";

const API = "https://dep.convex.site";

function gateJson(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "gate_abc",
    projectKey: "CLOUD",
    type: "clarification",
    title: "Which auth model?",
    payload: { question: "Device flow or token?" },
    state: "open",
    answer: null,
    createdBy: "agent:specflow-cli",
    resolvedBy: null,
    createdAt: "2026-06-04T10:00:00Z",
    resolvedAt: null,
    ...over,
  };
}

type Route = { method: string; test: (url: string) => boolean; status: number; body: unknown };

/** A scripted fetch: each request consumes the first matching route in order. */
function scripted(
  routes: Route[],
): { fetchFn: FetchFn; calls: { method: string; url: string; body: string | null }[] } {
  const calls: { method: string; url: string; body: string | null }[] = [];
  const remaining = [...routes];
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: (init?.body as string) ?? null });
    const idx = remaining.findIndex((r) => r.method === method && r.test(url));
    if (idx === -1) throw new Error(`no scripted route for ${method} ${url}`);
    const [r] = remaining.splice(idx, 1);
    return Promise.resolve(
      new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as FetchFn;
  return { fetchFn, calls };
}

Deno.test("reasonForStatus maps statuses; everything else is transient", () => {
  assertEquals(reasonForStatus(401), "unauthorized");
  assertEquals(reasonForStatus(404), "not_found");
  assertEquals(reasonForStatus(409), "conflict");
  assertEquals(reasonForStatus(422), "invalid");
  assertEquals(reasonForStatus(500), "transient");
  assertEquals(reasonForStatus(0), "transient");
});

Deno.test("open() posts the wire shape and returns the parsed gate", async () => {
  const { fetchFn, calls } = scripted([
    {
      method: "POST",
      test: (u) => u.endsWith("/api/v1/gates"),
      status: 201,
      body: { gate: gateJson() },
    },
  ]);
  const client = new GateClient(API, fetchFn);
  const gate = await client.open("tok", {
    projectKey: "CLOUD",
    type: "clarification",
    title: "Which auth model?",
    payload: { question: "Device flow or token?" },
    taskNumber: 42,
  });
  assertEquals(gate.id, "gate_abc");
  assertEquals(gate.state, "open");
  const sent = JSON.parse(calls[0].body!);
  assertEquals(sent.projectKey, "CLOUD");
  assertEquals(sent.taskNumber, 42);
  assertEquals(sent.type, "clarification");
});

Deno.test("open() maps a 422 to an invalid GateApiError", async () => {
  const { fetchFn } = scripted([
    {
      method: "POST",
      test: (u) => u.endsWith("/gates"),
      status: 422,
      body: { error: "internal-only-string" },
    },
  ]);
  const client = new GateClient(API, fetchFn);
  const err = await assertRejects(
    () =>
      client.open("tok", { projectKey: "CLOUD", type: "clarification", title: "t", payload: {} }),
    GateApiError,
  );
  assertEquals(err.reason, "invalid");
  assertEquals(err.status, 422);
  // § I: the backend's error string must NOT appear in the CLI-owned message.
  assertEquals(err.message.includes("internal-only-string"), false);
});

Deno.test("get() finds the gate by id, paging the opaque cursor", async () => {
  const { fetchFn } = scripted([
    {
      method: "GET",
      test: (u) => u.includes("/gates?") && !u.includes("cursor="),
      status: 200,
      body: { gates: [gateJson({ id: "gate_other" })], cursor: "c1", hasMore: true },
    },
    {
      method: "GET",
      test: (u) => u.includes("cursor=c1"),
      status: 200,
      body: {
        gates: [gateJson({ id: "gate_abc", state: "answered", answer: { text: "device flow" } })],
        cursor: "c2",
        hasMore: false,
      },
    },
  ]);
  const client = new GateClient(API, fetchFn);
  const gate = await client.get("tok", "CLOUD", "gate_abc");
  assertEquals(gate?.state, "answered");
  assertEquals(gate?.answer?.text, "device flow");
});

Deno.test("get() returns null when the gate isn't present", async () => {
  const { fetchFn } = scripted([
    {
      method: "GET",
      test: (u) => u.includes("/gates?"),
      status: 200,
      body: { gates: [], cursor: "", hasMore: false },
    },
  ]);
  const client = new GateClient(API, fetchFn);
  assertEquals(await client.get("tok", "CLOUD", "gate_abc"), null);
});

Deno.test("apply() returns the applied gate on 200", async () => {
  const { fetchFn } = scripted([
    {
      method: "POST",
      test: (u) => u.includes("/gates/gate_abc/apply"),
      status: 200,
      body: { gate: gateJson({ state: "applied" }) },
    },
  ]);
  const client = new GateClient(API, fetchFn);
  const gate = await client.apply("tok", "CLOUD", "gate_abc");
  assertEquals(gate.state, "applied");
});

Deno.test("apply() is idempotent: a 409 whose gate is already applied is success", async () => {
  const { fetchFn } = scripted([
    { method: "POST", test: (u) => u.includes("/apply"), status: 409, body: { error: "conflict" } },
    {
      method: "GET",
      test: (u) => u.includes("/gates?"),
      status: 200,
      body: { gates: [gateJson({ state: "applied" })], cursor: "", hasMore: false },
    },
  ]);
  const client = new GateClient(API, fetchFn);
  const gate = await client.apply("tok", "CLOUD", "gate_abc");
  assertEquals(gate.state, "applied");
});

Deno.test("apply() surfaces a real conflict (409 not-applied) as conflict", async () => {
  const { fetchFn } = scripted([
    { method: "POST", test: (u) => u.includes("/apply"), status: 409, body: { error: "conflict" } },
    {
      method: "GET",
      test: (u) => u.includes("/gates?"),
      status: 200,
      body: { gates: [gateJson({ state: "open" })], cursor: "", hasMore: false },
    },
  ]);
  const client = new GateClient(API, fetchFn);
  const err = await assertRejects(() => client.apply("tok", "CLOUD", "gate_abc"), GateApiError);
  assertEquals(err.reason, "conflict");
});

Deno.test("cancel() returns the cancelled gate; non-open is a conflict", async () => {
  const ok = scripted([
    {
      method: "POST",
      test: (u) => u.includes("/cancel"),
      status: 200,
      body: { gate: gateJson({ state: "cancelled" }) },
    },
  ]);
  assertEquals(
    (await new GateClient(API, ok.fetchFn).cancel("tok", "gate_abc")).state,
    "cancelled",
  );

  const conflict = scripted([
    { method: "POST", test: (u) => u.includes("/cancel"), status: 409, body: { error: "x" } },
  ]);
  const err = await assertRejects(
    () => new GateClient(API, conflict.fetchFn).cancel("tok", "gate_abc"),
    GateApiError,
  );
  assertEquals(err.reason, "conflict");
});

Deno.test("a network failure surfaces as a transient GateApiError (status 0)", async () => {
  const fetchFn = (() => Promise.reject(new TypeError("network down"))) as FetchFn;
  const err = await assertRejects(
    () =>
      new GateClient(API, fetchFn).open("tok", {
        projectKey: "CLOUD",
        type: "clarification",
        title: "t",
        payload: { question: "q" },
      }),
    GateApiError,
  );
  assertEquals(err.reason, "transient");
  assertEquals(err.status, 0);
});
