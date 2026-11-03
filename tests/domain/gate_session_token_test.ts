import { assertEquals, assertRejects } from "@std/assert";
import { makeGateSession, type TokenProvider } from "../../src/domain/cloud/gate_session.ts";
import { CloudApiError, type FetchFn } from "../../src/domain/cloud/cloud_client.ts";
import { Backend, fakeClock, gate, gateObj, REMOTE, session } from "./gate_fixture.ts";

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

Deno.test("makeGateSession: an expired login meeting a redirected refresh says redirected, keeps the login", async () => {
  const fetchFn = (() => Promise.resolve(new Response("{}", { status: 307 }))) as FetchFn;
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
  const redirected = { kind: "error", reason: "redirected" } as const;
  assertEquals(await s.raiseAndAwait(REQUEST), redirected);
  assertEquals(await s.cancel("gate_abc"), redirected);
});

Deno.test("makeGateSession: a refresh redirected mid-await ends it as a redirect, whatever the polls answer", async () => {
  for (const pollStatus of [401, 503]) {
    const paths: string[] = [];
    const fetchFn = ((url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path.endsWith("/auth/refresh")) {
        return Promise.resolve(new Response("{}", { status: 307 }));
      }
      return Promise.resolve(
        init?.method === "POST"
          ? new Response(JSON.stringify({ gate: gate() }), { status: 201 })
          : new Response("{}", { status: pollStatus }),
      );
    }) as FetchFn;
    const { now, sleep } = fakeClock();
    const s = makeGateSession({
      config: {
        apiUrl: "https://cloud.example.com",
        projectKey: "CLOUD",
        remote: { enabled: true },
      },
      // Good for the open; inside the refresh window by the first poll.
      store: {
        kind: "file",
        load: () =>
          Promise.resolve({ accessToken: "A", refreshToken: "R", accessExpiresAt: 65_000 }),
        save: () => Promise.resolve(),
        delete: () => Promise.reject(new Error("the login must be kept")),
      },
      fetchFn,
      env: () => undefined,
      now,
      sleep,
    })!;
    assertEquals(await s.raiseAndAwait(REQUEST), { kind: "error", reason: "redirected" });
    assertEquals(paths, ["/api/v1/gates", "/api/v1/auth/refresh"]);
  }
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

Deno.test("a stale 401, then a refresh that recovers: the answer arrives on the new token", async () => {
  const be = new Backend();
  be.state = "answered";
  be.answer = { text: "x" };
  const orig = be.fetch;
  let polls = 0;
  be.fetch =
    ((input: string | URL | Request, init?: RequestInit) =>
      (init?.method ?? "GET").toUpperCase() === "GET" && ++polls === 1
        ? Promise.resolve(new Response("{}", { status: 401 }))
        : orig(input, init)) as FetchFn;
  const tokens = ["first", new CloudApiError(503, "down"), "recovered"];
  let i = 0;
  const flaky: TokenProvider = () => {
    const next = tokens[i++];
    return typeof next === "string" ? Promise.resolve(next) : Promise.reject(next);
  };
  const out = await session(be, flaky).raiseAndAwait(REQUEST);
  assertEquals(out.kind === "answered" && out.answer, { text: "x" });
  assertEquals(polls, 2);
  assertEquals(be.tokensSeen.at(-1), "recovered");
});

Deno.test("a gate await backs off additively, caps at a minute, and resets on a success", async () => {
  const be = new Backend();
  be.failGetTimes = 14;
  const clock = fakeClock();
  const slept: number[] = [];
  const sleep = (ms: number) => {
    slept.push(ms);
    // The poll after the first success is the one that finds the answer.
    if (slept.length === 16) {
      be.state = "answered";
      be.answer = {};
    }
    return clock.sleep(ms);
  };
  const remote = { ...REMOTE, awaitTimeoutMs: 3_600_000 };
  const out = await session(be, () => Promise.resolve("tok"), remote, { ...clock, sleep })
    .raiseAndAwait(REQUEST);
  assertEquals(out.kind, "answered");
  const poll = REMOTE.pollIntervalMs;
  const grown = Array.from({ length: 12 }, (_, n) => poll + n * 5_000);
  const capped = [poll + 60_000, poll + 60_000, poll + 60_000];
  assertEquals(slept, [...grown, ...capped, poll]);
});

Deno.test("a logged-out cancel is unauthorized, and asks Cloud nothing", async () => {
  const be = new Backend();
  const out = await session(be, () => Promise.resolve(null)).cancel("gate_abc");
  assertEquals(out, { kind: "error", reason: "unauthorized" });
  assertEquals(be.tokensSeen, []);
});

// cli#737 — an answer that is not a verdict is not an outage, and an await still survives it.
Deno.test("a refresh answered with no verdict is unexpected, not unreachable", async () => {
  const noVerdict: TokenProvider = () => Promise.reject(new CloudApiError(200, "no verdict"));
  const out = await session(new Backend(), noVerdict).raiseAndAwait(REQUEST);
  assertEquals(out, { kind: "error", reason: "unexpected" });
});

Deno.test("a poll answered oddly is tolerated like a flap: the answer still arrives", async () => {
  const be = new Backend();
  be.state = "answered";
  be.answer = {};
  const orig = be.fetch;
  let polls = 0;
  be.fetch =
    ((input: string | URL | Request, init?: RequestInit) =>
      (init?.method ?? "GET").toUpperCase() === "GET" && ++polls === 1
        ? Promise.resolve(new Response("{}", { status: 429 }))
        : orig(input, init)) as FetchFn;
  const out = await session(be, () => Promise.resolve("tok")).raiseAndAwait(REQUEST);
  assertEquals(out.kind, "answered");
  assertEquals(polls, 2);
});

Deno.test("a 401 after a refresh with no verdict only says the token in hand expired", async () => {
  const be = new Backend();
  const orig = be.fetch;
  be.fetch =
    ((input: string | URL | Request, init?: RequestInit) =>
      (init?.method ?? "GET").toUpperCase() === "GET"
        ? Promise.resolve(new Response("{}", { status: 401 }))
        : orig(input, init)) as FetchFn;
  let calls = 0;
  const flaky: TokenProvider = () =>
    ++calls === 1 ? Promise.resolve("tok") : Promise.reject(new CloudApiError(200, "no verdict"));
  assertEquals(await session(be, flaky).raiseAndAwait(REQUEST), { kind: "unresolved" });
});

Deno.test("an answer that is a verdict ends an await at once", async () => {
  const reasons: [number, string][] = [[404, "not_found"], [409, "conflict"], [422, "invalid"]];
  for (const [status, reason] of reasons) {
    const be = new Backend();
    const orig = be.fetch;
    be.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() !== "GET") return orig(input, init);
      be.getCalls++;
      return Promise.resolve(new Response("{}", { status }));
    }) as FetchFn;
    const out = await session(be, () => Promise.resolve("tok")).raiseAndAwait(REQUEST);
    assertEquals(out, { kind: "error", reason } as never);
    assertEquals(be.getCalls, 1);
  }
});
