import { assertEquals, assertRejects } from "@std/assert";
import {
  CloudApiError,
  CloudClient,
  type FetchFn,
  isRedirected,
  isUnavailable,
} from "../../src/domain/cloud/cloud_client.ts";
import { accessToken } from "../../src/domain/cloud/auth_flow.ts";
import { GateApiError, GateClient } from "../../src/domain/cloud/gate_client.ts";
import { SpecApiError, SpecClient } from "../../src/domain/cloud/spec_client.ts";
import { Backend, session } from "./gate_fixture.ts";

// cli#736 — the rule: no Cloud request follows a redirect, and a 3xx is its own
// failure, never an outage worth retrying.

const API = "https://cloud.example.test";

function redirecting() {
  const modes: (string | undefined)[] = [];
  const fn = ((_: string, init?: RequestInit) => {
    modes.push(init?.redirect);
    return Promise.resolve(
      new Response("{}", { status: 307, headers: { Location: "https://other.example.test" } }),
    );
  }) as FetchFn;
  return { fn, modes };
}

const REQUEST = {
  projectKey: "CLOUD",
  type: "clarification",
  title: "t",
  payload: { question: "q" },
} as const;

Deno.test("every CloudClient request refuses a redirect, as a redirect and not as an outage", async () => {
  const { fn, modes } = redirecting();
  const c = new CloudClient(API, fn);
  const calls: (() => Promise<unknown>)[] = [
    () => c.startDevice(),
    () => c.pollToken("d"),
    () => c.refresh("r"),
    () => c.listProjects("t"),
    () => c.listOrgs("t"),
    () => c.listColumns("t", "K"),
    () => c.listTasks("t", "K"),
    () => c.createProject("t", "K", "n"),
    () => c.createTask("t", "K", "n"),
  ];
  for (const call of calls) {
    const e = await assertRejects(call, CloudApiError);
    assertEquals([isRedirected(e), isUnavailable(e), e.status], [true, false, 307]);
  }
  assertEquals(modes, calls.map(() => "manual"));
});

Deno.test("every SpecClient request refuses a redirect, and reads it as redirected", async () => {
  const { fn, modes } = redirecting();
  const c = new SpecClient(API, fn);
  const calls = [
    () => c.get("t", "K", 1),
    () => c.ensure("t", "K", 1),
    () => c.putSteps("t", "K", 1, []),
  ];
  for (const call of calls) {
    const e = await assertRejects(call as () => Promise<unknown>, SpecApiError);
    assertEquals(e.reason, "redirected");
  }
  assertEquals(modes, calls.map(() => "manual"));
});

Deno.test("every GateClient request refuses a redirect, and reads it as redirected", async () => {
  const { fn, modes } = redirecting();
  const c = new GateClient(API, fn);
  const calls = [
    () => c.open("t", REQUEST),
    () => c.get("t", "K", "g"),
    () => c.apply("t", "K", "g"),
    () => c.cancel("t", "g"),
  ];
  for (const call of calls) {
    const e = await assertRejects(call as () => Promise<unknown>, GateApiError);
    assertEquals(e.reason, "redirected");
  }
  assertEquals(modes, calls.map(() => "manual"));
});

Deno.test("a redirect ends a gate await at once: it is not a flap to retry", async () => {
  const be = new Backend();
  const orig = be.fetch;
  be.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if ((init?.method ?? "GET").toUpperCase() !== "GET") return orig(input, init);
    be.getCalls++;
    return Promise.resolve(new Response("{}", { status: 302 }));
  }) as FetchFn;
  const out = await session(be, () => Promise.resolve("tok")).raiseAndAwait(REQUEST);
  assertEquals(out, { kind: "error", reason: "redirected" });
  assertEquals(be.getCalls, 1);
});

Deno.test("a refresh meeting a redirect keeps the login", async () => {
  const { fn } = redirecting();
  const store = {
    kind: "file" as const,
    load: () => Promise.resolve({ accessToken: "A", refreshToken: "R", accessExpiresAt: 0 }),
    save: () => Promise.reject(new Error("nothing to save")),
    delete: () => Promise.reject(new Error("the login must be kept")),
  };
  const e = await assertRejects(
    () => accessToken({ apiUrl: API, client: new CloudClient(API, fn), store, now: () => 1 }),
    CloudApiError,
  );
  assertEquals(isRedirected(e), true);
});
