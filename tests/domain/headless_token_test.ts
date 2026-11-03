import { assertEquals } from "@std/assert";
import { headlessToken, normalizeApiUrl } from "../../src/domain/cloud/cloud_config.ts";
import { makeSpecSession } from "../../src/domain/cloud/spec_session.ts";
import { makeGateSession } from "../../src/domain/cloud/gate_session.ts";
import type { FetchFn } from "../../src/domain/cloud/cloud_client.ts";
import type { CredentialStore } from "../../src/domain/cloud/credentials.ts";

// monorepo#44 — a headless token is bound to no deployment, so it goes only to
// the canonical endpoint or the origin the environment itself names.

const TOKEN = "headless-secret";
const env = (extra: Record<string, string> = {}) => (k: string) =>
  ({ SPECNAUT_CLOUD_TOKEN: TOKEN, ...extra })[k];

Deno.test("headlessToken: the canonical endpoint and the environment's own origin only", () => {
  assertEquals(headlessToken("https://api.specnaut.com/", env()), { token: TOKEN });
  assertEquals(
    headlessToken(
      "https://cloud.dev.test/x",
      env({ SPECNAUT_CLOUD_API_URL: "https://cloud.dev.test" }),
    ),
    { token: TOKEN },
  );
  for (
    const url of [
      "https://api.example.com",
      "http://api.specnaut.com",
      "https://api.specnaut.com:8443",
    ]
  ) {
    assertEquals("refused" in (headlessToken(url, env()) ?? {}), true, url);
  }
  assertEquals("refused" in (headlessToken("file:///etc/passwd", env()) ?? {}), true);
  assertEquals(headlessToken("https://api.example.com", () => undefined), null);
  // The legacy name is bound by the same rule.
  assertEquals(
    "refused" in
      (headlessToken(
        "https://api.example.com",
        (k) => (k === "SPECFLOW_CLOUD_TOKEN" ? TOKEN : undefined),
      ) ?? {}),
    true,
  );
});

Deno.test("headlessToken: the environment naming one deployment does not admit another", () => {
  const named = env({ SPECNAUT_CLOUD_API_URL: "https://cloud-a.example.test" });
  assertEquals("refused" in (headlessToken("https://cloud-b.example.test", named) ?? {}), true);
  // The same origin to `URL`, another host to curl's resolver.
  const ip = env({ SPECNAUT_CLOUD_API_URL: "http://127.0.0.1:3000" });
  assertEquals("refused" in (headlessToken("http://127.0.0.1.:3000", ip) ?? {}), true);
  assertEquals("refused" in (headlessToken("http://127.0x.0.1:3000", ip) ?? {}), true);
  assertEquals(headlessToken("http://127.0.0.1:3000", ip), { token: TOKEN });
  // Nor a URL that a second parser would read as another host.
  assertEquals(
    "refused" in (headlessToken("https://api.specnaut.com\\@collector.invalid", env()) ?? {}),
    true,
  );
});

Deno.test("normalizeApiUrl: nothing two URL parsers could read as different hosts", () => {
  for (
    const url of [
      "https://api.specnaut.com\\@collector.invalid",
      "https://user:pw@api.specnaut.com",
      "https://api.specnaut.com?x=1",
      "https://api.specnaut.com/?",
      "https://api.specnaut.com#f",
      "https://api.spec naut.com",
      "https://api.specnaut.com\tx",
    ]
  ) assertEquals(normalizeApiUrl(url), null, url);
});

Deno.test("normalizeApiUrl: http(s) only, trailing slashes dropped", () => {
  assertEquals(normalizeApiUrl(" https://api.example.com// "), "https://api.example.com");
  assertEquals(normalizeApiUrl("file:///tmp/x"), null);
  assertEquals(normalizeApiUrl("not a url"), null);
});

const stubStore: CredentialStore = {
  kind: "file",
  load: () => Promise.resolve(null),
  save: () => Promise.resolve(),
  delete: () => Promise.resolve(),
};

/** The user's own login for that deployment: a request goes out, and must carry it. */
const loggedIn: CredentialStore = {
  ...stubStore,
  load: () =>
    Promise.resolve({ accessToken: "stored", refreshToken: "r", accessExpiresAt: 8.64e15 }),
};

/** A fetch recording every Authorization header it was handed. */
function recorder() {
  const auth: (string | null)[] = [];
  const fetchFn = ((_: string, init?: RequestInit) => {
    auth.push(new Headers(init?.headers).get("Authorization"));
    return Promise.resolve(new Response(JSON.stringify({ spec: null }), { status: 200 }));
  }) as FetchFn;
  return { auth, fetchFn };
}

Deno.test("a spec session for a repository-chosen api_url never sends the headless token", async () => {
  const { auth, fetchFn } = recorder();
  const warned: string[] = [];
  const session = makeSpecSession({
    config: { apiUrl: "https://collector.example.test", projectKey: "CLOUD" },
    store: loggedIn,
    fetchFn,
    env: env(),
    warn: (m) => warned.push(m),
  })!;
  assertEquals(await session.pull(1), null);
  assertEquals(
    auth.length > 0 && auth.every((a) => a === "Bearer stored"),
    true,
    JSON.stringify(auth),
  );
  assertEquals(warned.length, 1);
  assertEquals(warned[0].includes("https://collector.example.test"), true, warned[0]);
});

Deno.test("a gate session for a repository-chosen api_url never sends the headless token", async () => {
  const { auth, fetchFn } = recorder();
  const warned: string[] = [];
  const session = makeGateSession({
    config: {
      apiUrl: "https://collector.example.test",
      projectKey: "CLOUD",
      remote: { enabled: true },
    },
    store: loggedIn,
    fetchFn,
    env: env(),
    warn: (m) => warned.push(m),
  })!;
  const out = await session.raiseAndAwait(
    { type: "clarification", payload: { question: "q" } } as never,
  );
  assertEquals(out.kind, "error");
  assertEquals(
    auth.length > 0 && auth.every((a) => a === "Bearer stored"),
    true,
    JSON.stringify(auth),
  );
  assertEquals(warned.length, 1);
});

Deno.test("a session for a non-http(s) api_url is not built at all", () => {
  const config = { apiUrl: "file:///tmp/x", projectKey: "CLOUD" };
  assertEquals(makeSpecSession({ config, store: stubStore, env: env() }), null);
  assertEquals(makeGateSession({ config, store: stubStore, env: env() }), null);
});

Deno.test("a gate session for the deployment the environment names sends the headless token", async () => {
  const { auth, fetchFn } = recorder();
  const session = makeGateSession({
    config: { apiUrl: "https://cloud.dev.test", projectKey: "CLOUD", remote: { enabled: true } },
    store: stubStore,
    fetchFn,
    env: env({ SPECNAUT_CLOUD_API_URL: "https://cloud.dev.test/" }),
  })!;
  await session.raiseAndAwait({ type: "clarification", payload: { question: "q" } } as never);
  assertEquals(
    auth.length > 0 && auth.every((a) => a === `Bearer ${TOKEN}`),
    true,
    JSON.stringify(auth),
  );
});
