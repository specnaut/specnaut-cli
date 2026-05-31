import { assertEquals } from "@std/assert";
import { freshAccessToken, login } from "../../src/domain/cloud/auth_flow.ts";
import type { CloudClient, RefreshResult, TokenPoll } from "../../src/domain/cloud/cloud_client.ts";
import type {
  CloudCredentials,
  CredentialStore,
} from "../../src/infrastructure/credential_store.ts";

const API = "https://dep.convex.site";

class MemStore implements CredentialStore {
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

Deno.test("freshAccessToken: returns cached token when not near expiry", async () => {
  const store = new MemStore();
  const clock = fakeClock(0);
  await store.save(API, {
    accessToken: "CACHED",
    refreshToken: "RT",
    accessExpiresAt: 10 * 60_000, // 10 min out
  });
  let refreshed = false;
  const token = await freshAccessToken({
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

Deno.test("freshAccessToken: refreshes transparently when near expiry", async () => {
  const store = new MemStore();
  const clock = fakeClock(0);
  await store.save(API, {
    accessToken: "OLD",
    refreshToken: "RT_OLD",
    accessExpiresAt: 1_000, // ~now → within skew
  });
  const token = await freshAccessToken({
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

Deno.test("freshAccessToken: dead refresh token → null and creds cleared", async () => {
  const store = new MemStore();
  const clock = fakeClock(0);
  await store.save(API, {
    accessToken: "OLD",
    refreshToken: "RT_DEAD",
    accessExpiresAt: 0,
  });
  const token = await freshAccessToken({
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

Deno.test("freshAccessToken: no stored creds → null", async () => {
  const store = new MemStore();
  const token = await freshAccessToken({
    apiUrl: API,
    client: fakeClient({}),
    store,
    now: () => 0,
  });
  assertEquals(token, null);
});
