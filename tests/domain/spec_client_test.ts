import { assertEquals, assertRejects } from "@std/assert";
import { reasonForStatus, SpecApiError, SpecClient } from "../../src/domain/cloud/spec_client.ts";
import type { FetchFn } from "../../src/domain/cloud/cloud_client.ts";

// Spec 020 / SC-006 — the spec HTTP client. Mirrors gate_client_test: a scripted
// fake fetch, status-only errors, and the § I boundary check that no backend
// `error` string / `_id` ever surfaces in a CLI-owned message or the parsed spec.

const API = "https://dep.convex.site";

function specJson(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    // A private-half id the CLI must NEVER surface — proves parseSpec drops it.
    _id: "cloud_internal_deadbeef",
    taskNumber: 154,
    title: "Cloud-hosted specs",
    steps: [
      { key: "specify", name: "Specify", order: 1, body: "# spec body" },
      { key: "plan", name: "Plan", order: 2, body: "# plan body" },
    ],
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

Deno.test("ensure() posts projectKey/taskNumber and returns the parsed spec", async () => {
  const { fetchFn, calls } = scripted([
    {
      method: "POST",
      test: (u) => u.endsWith("/api/v1/specs"),
      status: 201,
      body: { spec: specJson() },
    },
  ]);
  const spec = await new SpecClient(API, fetchFn).ensure("tok", "CLOUD", 154, "Cloud-hosted specs");
  assertEquals(spec.taskNumber, 154);
  assertEquals(spec.steps.length, 2);
  const sent = JSON.parse(calls[0].body!);
  assertEquals(sent.projectKey, "CLOUD");
  assertEquals(sent.taskNumber, 154);
  assertEquals(sent.title, "Cloud-hosted specs");
});

Deno.test("get() returns the spec with steps sorted by order", async () => {
  const { fetchFn, calls } = scripted([
    {
      method: "GET",
      test: (u) => u.includes("/specs?") && u.includes("taskNumber=154"),
      status: 200,
      body: {
        spec: specJson({
          steps: [
            { key: "plan", name: "Plan", order: 2, body: "b2" },
            { key: "specify", name: "Specify", order: 1, body: "b1" },
          ],
        }),
      },
    },
  ]);
  const spec = await new SpecClient(API, fetchFn).get("tok", "CLOUD", 154);
  assertEquals(spec?.steps.map((s) => s.key), ["specify", "plan"]);
  assertEquals(calls[0].url.includes("projectKey=CLOUD"), true);
});

Deno.test("get() returns null when the task has no spec (null body or 404)", async () => {
  const nullBody = scripted([
    { method: "GET", test: (u) => u.includes("/specs?"), status: 200, body: { spec: null } },
  ]);
  assertEquals(await new SpecClient(API, nullBody.fetchFn).get("tok", "CLOUD", 9), null);

  const notFound = scripted([
    { method: "GET", test: (u) => u.includes("/specs?"), status: 404, body: { error: "nope" } },
  ]);
  assertEquals(await new SpecClient(API, notFound.fetchFn).get("tok", "CLOUD", 9), null);
});

Deno.test("putSteps() sends only key/name/order/body per step (§ I opaque shape)", async () => {
  const { fetchFn, calls } = scripted([
    { method: "PUT", test: (u) => u.endsWith("/specs/steps"), status: 200, body: {} },
  ]);
  await new SpecClient(API, fetchFn).putSteps("tok", "CLOUD", 154, [
    { key: "specify", name: "Specify", order: 1, body: "b" },
  ]);
  const sent = JSON.parse(calls[0].body!);
  assertEquals(sent.projectKey, "CLOUD");
  assertEquals(sent.taskNumber, 154);
  assertEquals(Object.keys(sent.steps[0]).sort(), ["body", "key", "name", "order"]);
});

Deno.test("a 422 maps to an invalid SpecApiError and never leaks the backend error string (§ I)", async () => {
  const { fetchFn } = scripted([
    {
      method: "PUT",
      test: (u) => u.includes("/specs/steps"),
      status: 422,
      body: { error: "internal-only-string" },
    },
  ]);
  const err = await assertRejects(
    () => new SpecClient(API, fetchFn).putSteps("tok", "CLOUD", 1, []),
    SpecApiError,
  );
  assertEquals(err.reason, "invalid");
  assertEquals(err.status, 422);
  assertEquals(err.message.includes("internal-only-string"), false);
});

Deno.test("a network failure surfaces as a transient SpecApiError (status 0)", async () => {
  const fetchFn = (() => Promise.reject(new TypeError("network down"))) as FetchFn;
  const err = await assertRejects(
    () => new SpecClient(API, fetchFn).get("tok", "CLOUD", 1),
    SpecApiError,
  );
  assertEquals(err.reason, "transient");
  assertEquals(err.status, 0);
});

Deno.test("parsed spec never carries the backend's _id (§ I)", async () => {
  const { fetchFn } = scripted([
    { method: "GET", test: (u) => u.includes("/specs?"), status: 200, body: { spec: specJson() } },
  ]);
  const spec = await new SpecClient(API, fetchFn).get("tok", "CLOUD", 154);
  assertEquals(JSON.stringify(spec).includes("cloud_internal_deadbeef"), false);
  assertEquals(JSON.stringify(spec).includes("_id"), false);
});
