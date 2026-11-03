import { assertEquals, assertRejects } from "@std/assert";
import { accessToken, login } from "../../src/domain/cloud/auth_flow.ts";
import {
  CloudApiError,
  CloudClient,
  type RefreshResult,
  type TokenPoll,
} from "../../src/domain/cloud/cloud_client.ts";
import type { CloudCredentials, CredentialStore } from "../../src/domain/cloud/credentials.ts";

const API = "https://api.example.com";

class MemStore implements CredentialStore {
  readonly kind = "file" as const;
  m = new Map<string, CloudCredentials>();
  load(u: string) {
    return Promise.resolve(this.m.get(u) ?? null);
  }
  save(u: string, c: CloudCredentials) {
    this.m.set(u, c);
    return Promise.resolve();
  }
  delete(u: string) {
    this.m.delete(u);
    return Promise.resolve();
  }
}

/** A controllable clock: sleep advances it so deadlines are deterministic. */
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

function fakeClient(over: Partial<CloudClient>): CloudClient {
  return over as unknown as CloudClient;
}

const DEVICE_START = {
  deviceCode: "sfd_x",
  userCode: "ABCD-1234",
  verificationUri: `${API}/cli`,
  verificationUriComplete: `${API}/cli?code=ABCD-1234`,
  expiresInS: 900,
  intervalS: 5,
};

Deno.test("login: pending then approved → stores creds with computed expiry", async () => {
  const store = new MemStore();
  const clock = fakeClock(1_000);
  const polls: TokenPoll[] = [
    { status: "pending" },
    { status: "approved", accessToken: "AT", refreshToken: "RT", expiresInS: 3600 },
  ];
  let opened = "";

  const result = await login({
    apiUrl: API,
    client: fakeClient({
      startDevice: () => Promise.resolve(DEVICE_START),
      pollToken: () => Promise.resolve(polls.shift()!),
    }),
    store,
    io: { log: () => {} },
    openUrl: (u) => {
      opened = u;
      return Promise.resolve();
    },
    now: clock.now,
    sleep: clock.sleep,
  });

  assertEquals(result, { ok: true });
  assertEquals(opened, DEVICE_START.verificationUriComplete);
  const creds = store.m.get(API)!;
  assertEquals(creds.accessToken, "AT");
  assertEquals(creds.refreshToken, "RT");
  // Two polls (pending → approved) ⇒ two 5s sleeps from start 1000, then +3600s.
  assertEquals(creds.accessExpiresAt, 1_000 + 5_000 + 5_000 + 3600_000);
});

Deno.test("login: denied → ok:false, nothing stored", async () => {
  const store = new MemStore();
  const clock = fakeClock();
  const result = await login({
    apiUrl: API,
    client: fakeClient({
      startDevice: () => Promise.resolve(DEVICE_START),
      pollToken: () => Promise.resolve({ status: "denied" }),
    }),
    store,
    io: { log: () => {} },
    openUrl: () => Promise.resolve(),
    now: clock.now,
    sleep: clock.sleep,
  });
  assertEquals(result, { ok: false, reason: "denied" });
  assertEquals(store.m.size, 0);
});

Deno.test("login: never approved before deadline → timeout", async () => {
  const store = new MemStore();
  const clock = fakeClock();
  const result = await login({
    apiUrl: API,
    client: fakeClient({
      startDevice: () => Promise.resolve({ ...DEVICE_START, expiresInS: 12 }),
      pollToken: () => Promise.resolve({ status: "pending" }),
    }),
    store,
    io: { log: () => {} },
    openUrl: () => Promise.resolve(),
    now: clock.now,
    sleep: clock.sleep,
  });
  assertEquals(result, { ok: false, reason: "timeout" });
});

Deno.test("accessToken: returns cached token when not near expiry", async () => {
  const store = new MemStore();
  const clock = fakeClock(0);
  await store.save(API, {
    accessToken: "CACHED",
    refreshToken: "RT",
    accessExpiresAt: 10 * 60_000, // 10 min out
  });
  let refreshed = false;
  const token = await accessToken({
    apiUrl: API,
    client: fakeClient({
      refresh: () => {
        refreshed = true;
        return Promise.resolve({ status: "invalid" } as RefreshResult);
      },
    }),
    store,
    now: clock.now,
  });
  assertEquals(token, "CACHED");
  assertEquals(refreshed, false);
});

Deno.test("accessToken: refreshes transparently when near expiry", async () => {
  const store = new MemStore();
  const clock = fakeClock(0);
  await store.save(API, {
    accessToken: "OLD",
    refreshToken: "RT_OLD",
    accessExpiresAt: 1_000, // ~now → within skew
  });
  const token = await accessToken({
    apiUrl: API,
    client: fakeClient({
      refresh: (rt: string) => {
        assertEquals(rt, "RT_OLD");
        return Promise.resolve({
          status: "ok",
          accessToken: "NEW",
          refreshToken: "RT_NEW",
          expiresInS: 3600,
        });
      },
    }),
    store,
    now: clock.now,
  });
  assertEquals(token, "NEW");
  const stored = store.m.get(API)!;
  assertEquals(stored.accessToken, "NEW");
  assertEquals(stored.refreshToken, "RT_NEW");
});

Deno.test("accessToken: dead refresh token → null and creds cleared", async () => {
  const store = new MemStore();
  const clock = fakeClock(0);
  await store.save(API, {
    accessToken: "OLD",
    refreshToken: "RT_DEAD",
    accessExpiresAt: 0,
  });
  const token = await accessToken({
    apiUrl: API,
    client: fakeClient({
      refresh: () => Promise.resolve({ status: "invalid" }),
    }),
    store,
    now: clock.now,
  });
  assertEquals(token, null);
  assertEquals(store.m.has(API), false);
});

Deno.test("accessToken: no stored creds → null", async () => {
  const store = new MemStore();
  const token = await accessToken({
    apiUrl: API,
    client: fakeClient({}),
    store,
    now: () => 0,
  });
  assertEquals(token, null);
});

// cli#734 — through the real CloudClient: only Cloud's literal verdict on the
// refresh token drops the credentials; any other answer throws and keeps them.
for (
  const [status, body, dropped] of [
    [401, { status: "invalid" }, true],
    [401, { status: "expired" }, true],
    [400, { error: "bad request" }, false],
    [401, { status: ["invalid"] }, false],
    [200, { status: "ok" }, false],
    [429, {}, false],
    [503, {}, false],
    [200, "<html>captive portal</html>", false],
    [200, "null", false],
    [200, "[]", false],
  ] as const
) {
  Deno.test(`accessToken: a refresh answered ${status} ${JSON.stringify(body)} ${dropped ? "drops" : "keeps"} the creds`, async () => {
    const store = new MemStore();
    await store.save(API, { accessToken: "OLD", refreshToken: "RT", accessExpiresAt: 0 });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    const fetchFn = (() => Promise.resolve(new Response(text, { status }))) as typeof fetch;
    const deps = { apiUrl: API, client: new CloudClient(API, fetchFn), store, now: () => 0 };
    if (dropped) assertEquals(await accessToken(deps), null);
    else await assertRejects(() => accessToken(deps), CloudApiError);
    assertEquals(store.m.has(API), !dropped);
  });
}

/** A login that goes as far as opening a page: what it opened, and what it printed. */
async function pageOf(complete: string) {
  const client = new CloudClient(API, (() => Promise.reject(new Error("unused"))) as typeof fetch);
  client.startDevice = () =>
    Promise.resolve({ ...DEVICE_START, verificationUriComplete: complete });
  client.pollToken = () => Promise.resolve({ status: "denied" });
  const logs: string[] = [];
  let opened = "";
  const store = {
    kind: "file" as const,
    load: () => Promise.resolve(null),
    save: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  };
  const openUrl = (u: string) => Promise.resolve(void (opened = u));
  const io = { log: (m: string) => void logs.push(m) };
  const sleep = () => Promise.resolve();
  await login({ apiUrl: API, client, store, io, openUrl, now: () => 0, sleep });
  return { opened, printed: logs.join("\n") };
}

Deno.test("login opens the verification page it prints", async () => {
  const prefilled = `${API}/cli?code=ABCD-1234`;
  const same = await pageOf(prefilled);
  assertEquals(same.opened, prefilled);
  assertEquals(same.printed.includes(`visit:  ${prefilled}`), true, same.printed);
  assertEquals(same.printed.includes("and check the code"), true, same.printed);
  const host = new URL(API);
  const others = [
    "https://other.example.test/cli",
    `${host.protocol === "https:" ? "http:" : "https:"}//${host.host}/cli`,
    `${host.protocol}//${host.hostname}:8443/cli`,
    "not a url",
  ];
  for (const other of others) {
    const { opened, printed } = await pageOf(other);
    assertEquals(opened, DEVICE_START.verificationUri, other);
    assertEquals(printed.includes(`visit:  ${opened}`), true, printed);
    assertEquals(printed.includes("and enter the code"), true, printed);
  }
});
