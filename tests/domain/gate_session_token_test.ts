import { assertEquals, assertRejects } from "@std/assert";
import { makeGateSession, type TokenProvider } from "../../src/domain/cloud/gate_session.ts";
import { CloudApiError, type FetchFn } from "../../src/domain/cloud/cloud_client.ts";
import { Backend, gateObj, session } from "./gate_fixture.ts";

// cli#735 — a refresh with no verdict is not a lost login: the gate says transient.
const REQUEST = {
  projectKey: "CLOUD",
  type: "clarification",
  title: "t",
  payload: { question: "q" },
} as const;
const unavailable: TokenProvider = () => Promise.reject(new CloudApiError(503, "down"));

Deno.test("a gate with no verdict on the token reports transient; with no login, its old reasons", async () => {
  const be = new Backend();
  const down = session(be, unavailable);
  assertEquals(await down.raiseAndAwait(REQUEST), { kind: "error", reason: "transient" });
  assertEquals(await down.apply(gateObj(be)), { kind: "error", reason: "transient" });
  assertEquals(await down.cancel("gate_abc"), { kind: "error", reason: "transient" });
  const out = session(be, () => Promise.resolve(null));
  assertEquals(await out.raiseAndAwait(REQUEST), { kind: "error", reason: "no_remote" });
  assertEquals(await out.apply(gateObj(be)), { kind: "error", reason: "unauthorized" });
});

Deno.test("a refresh failing mid-await keeps the token in hand and keeps polling", async () => {
  const be = new Backend();
  be.state = "answered";
  be.answer = { text: "x" };
  let calls = 0;
  const flaky: TokenProvider = () =>
    ++calls === 1 ? Promise.resolve("tok") : Promise.reject(new CloudApiError(0, "offline"));
  const out = await session(be, flaky).raiseAndAwait(REQUEST);
  assertEquals(out.kind, "answered");
});

Deno.test("an error that is not Cloud's is not dressed up as transient", async () => {
  const bug: TokenProvider = () => Promise.reject(new RangeError("bug"));
  await assertRejects(() => session(new Backend(), bug).raiseAndAwait(REQUEST), RangeError);
});

// Through the real wiring: an expired login, and a refresh Cloud cannot serve.
Deno.test("makeGateSession: an expired login meeting a 503 refresh is transient, not a lost login", async () => {
  // Every request answers 503, so the URLs say it was the refresh that failed, and nothing else ran.
  const urls: string[] = [];
  const fetchFn = ((url: string) => {
    urls.push(new URL(url).pathname);
    return Promise.resolve(new Response("{}", { status: 503 }));
  }) as FetchFn;
  const s = makeGateSession({
    config: { apiUrl: "https://cloud.example.com", projectKey: "CLOUD", remote: { enabled: true } },
    store: {
      kind: "file",
      load: () => Promise.resolve({ accessToken: "A", refreshToken: "R", accessExpiresAt: 0 }),
      save: () => Promise.resolve(),
      delete: () => Promise.reject(new Error("the login must be kept")),
    },
    fetchFn,
    env: () => undefined,
  })!;
  assertEquals(await s.raiseAndAwait(REQUEST), { kind: "error", reason: "transient" });
  assertEquals(urls, ["/api/v1/auth/refresh"]);
});

Deno.test("a 401 ends the await, unless the last refresh got no verdict: then the token only expired", async () => {
  const unauthorized = new Backend();
  const orig = unauthorized.fetch;
  const be401 =
    ((input: string | URL | Request, init?: RequestInit) =>
      (init?.method ?? "GET").toUpperCase() === "GET"
        ? Promise.resolve(new Response("{}", { status: 401 }))
        : orig(input, init)) as FetchFn;
  unauthorized.fetch = be401;
  const live = await session(unauthorized, () => Promise.resolve("tok")).raiseAndAwait(REQUEST);
  assertEquals(live, { kind: "error", reason: "unauthorized" });
  let calls = 0;
  const flaky: TokenProvider = () =>
    ++calls === 1 ? Promise.resolve("tok") : Promise.reject(new CloudApiError(503, "down"));
  const stale = await session(unauthorized, flaky).raiseAndAwait(REQUEST);
  assertEquals(stale, { kind: "unresolved" });
  // A refresh that condemned the login is a verdict, not a flap: the 401 ends the await.
  calls = 0;
  const refused: TokenProvider = () => Promise.resolve(++calls === 1 ? "tok" : null);
  const out = await session(unauthorized, refused).raiseAndAwait(REQUEST);
  assertEquals(out, { kind: "error", reason: "unauthorized" });
});
