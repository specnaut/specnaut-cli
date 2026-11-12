import { assertEquals, assertRejects } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
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
import { Backend, PATTERNS, session } from "./gate_fixture.ts";

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

/** The calls, once they are shown to cover every method the client has: a new one fails here. */
function covering(
  client: { prototype: object },
  internal: string[],
  calls: Record<string, () => Promise<unknown>>,
): (() => Promise<unknown>)[] {
  const methods = Object.getOwnPropertyNames(client.prototype)
    .filter((m) => m !== "constructor" && !internal.includes(m));
  assertEquals(Object.keys(calls).sort(), methods.sort());
  return Object.values(calls);
}

Deno.test("no client reaches fetch except through cloudFetch", async () => {
  const dir = fromFileUrl(new URL("../../src/domain/cloud", import.meta.url));
  const clients: string[] = [];
  for await (const f of Deno.readDir(dir)) {
    const text = await Deno.readTextFile(join(dir, f.name));
    clients.push(...[...text.matchAll(/export class (\w+Client)\b/g)].map((m) => m[1]));
    if (f.name === "cloud_wire.ts") continue;
    assertEquals(/\b(fetch|fetchFn)\(/.test(text), false, f.name);
  }
  // A client this file does not exercise fails here, until it does.
  assertEquals(clients.sort(), ["CloudClient", "GateClient", "SpecClient"]);
});

Deno.test("every CloudClient request refuses a redirect, as a redirect and not as an outage", async () => {
  const { fn, modes } = redirecting();
  const c = new CloudClient(API, fn, PATTERNS);
  const calls = covering(CloudClient, ["send", "postJson", "getJson"], {
    startDevice: () => c.startDevice(),
    pollToken: () => c.pollToken("d"),
    refresh: () => c.refresh("r"),
    listProjects: () => c.listProjects("t"),
    listOrgs: () => c.listOrgs("t"),
    listColumns: () => c.listColumns("t", "K"),
    listTasks: () => c.listTasks("t", "K"),
    createProject: () => c.createProject("t", "K", "n"),
    createTask: () => c.createTask("t", "K", "n"),
  });
  for (const call of calls) {
    const e = await assertRejects(call, CloudApiError);
    assertEquals([isRedirected(e), isUnavailable(e), e.status], [true, false, 307]);
  }
  assertEquals(modes, calls.map(() => "manual"));
});

Deno.test("every SpecClient request refuses a redirect, and reads it as redirected", async () => {
  const { fn, modes } = redirecting();
  const c = new SpecClient(API, fn, PATTERNS);
  const calls = covering(SpecClient, ["send"], {
    get: () => c.get("t", "K", 1),
    ensure: () => c.ensure("t", "K", 1),
    putSteps: () => c.putSteps("t", "K", 1, []),
  });
  for (const call of calls) {
    const e = await assertRejects(call as () => Promise<unknown>, SpecApiError);
    assertEquals(e.reason, "redirected");
  }
  assertEquals(modes, calls.map(() => "manual"));
});

Deno.test("every GateClient request refuses a redirect, and reads it as redirected", async () => {
  const { fn, modes } = redirecting();
  const c = new GateClient(API, fn, PATTERNS);
  const calls = covering(GateClient, ["send"], {
    open: () => c.open("t", REQUEST),
    get: () => c.get("t", "K", "g"),
    apply: () => c.apply("t", "K", "g"),
    cancel: () => c.cancel("t", "g"),
  });
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
