import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { deviceLogin } from "../../src/cli/handlers/cloud_login.ts";
import { CloudClient, type FetchFn } from "../../src/domain/cloud/cloud_client.ts";
import type { CredentialStore } from "../../src/domain/cloud/credentials.ts";

// cli#736 — a login that cannot finish says why; it never ends in a stack.

const API = "https://cloud.example.test";
const DEVICE = {
  device_code: "d",
  user_code: "U",
  verification_uri: `${API}/v`,
  expires_in: 900,
  interval: 5,
};
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

function recordingStore() {
  const saved: unknown[] = [];
  const store: CredentialStore = {
    kind: "file",
    load: () => Promise.resolve(null),
    save: (_, c) => {
      saved.push(c);
      return Promise.resolve();
    },
    delete: () => Promise.resolve(),
  };
  return { store, saved };
}

async function run(fetchFn: FetchFn) {
  const { store, saved } = recordingStore();
  const original = console.error;
  const lines: string[] = [];
  console.error = (...a: unknown[]) => void lines.push(a.join(" "));
  let t = 0;
  try {
    const ok = await deviceLogin({
      apiUrl: API,
      client: new CloudClient(API, fetchFn),
      store,
      io: { log: () => {} },
      openUrl: () => Promise.resolve(),
      now: () => t,
      sleep: (ms) => Promise.resolve(void (t += ms)),
    });
    return { ok, err: lines.join("\n"), saved };
  } finally {
    console.error = original;
  }
}

/** Starts the device flow, then answers every poll with `poll`. */
const polling = (poll: () => Promise<Response>) =>
  ((url: string) => String(url).endsWith("/auth/device") ? json(200, DEVICE) : poll()) as FetchFn;

Deno.test("deviceLogin: a dropped connection, starting or polling, is a message", async () => {
  const offline = () => Promise.reject(new TypeError("connection reset"));
  for (const fetchFn of [offline as FetchFn, polling(offline)]) {
    const { ok, err, saved } = await run(fetchFn);
    assertEquals([ok, saved.length], [false, 0]);
    assertStringIncludes(err, "cannot be reached");
    assertStringIncludes(err, "specnaut cloud login");
  }
});

Deno.test("deviceLogin: a redirect, starting or polling, is said as one and not as an outage", async () => {
  const moved = () => json(307, {});
  for (const fetchFn of [moved as FetchFn, polling(moved)]) {
    const { ok, err } = await run(fetchFn);
    assertEquals(ok, false);
    assertStringIncludes(err, "redirected the request");
    assertEquals(err.includes("cannot be reached"), false, err);
  }
});

Deno.test("deviceLogin: Cloud failing to start is a message without Cloud's own text (§ I)", async () => {
  const { ok, err } = await run((() => json(400, { error: "internal-detail" })) as FetchFn);
  assertEquals(ok, false);
  assertStringIncludes(err, "answered unexpectedly");
  assertEquals(err.includes("internal-detail"), false, err);
});

Deno.test("deviceLogin: a refusal keeps its reason, an approval stores the login and prints nothing", async () => {
  const endings: [string, string][] = [
    ["denied", "authorization was denied."],
    ["expired", "the code expired before approval."],
    ["invalid", "the authorization request was invalid."],
    ["pending", "timed out waiting for approval."],
  ];
  for (const [status, words] of endings) {
    const r = await run(polling(() => json(200, { status })));
    assertEquals(r.ok, false, status);
    assertStringIncludes(r.err, `error: ${words}`);
  }
  const approved = await run(
    polling(() =>
      json(200, { status: "approved", access_token: "a", refresh_token: "r", expires_in: 60 })
    ),
  );
  assertEquals([approved.ok, approved.err, approved.saved.length], [true, "", 1]);
});

Deno.test("deviceLogin: an error that is not Cloud's is not dressed up as a failed login", async () => {
  const bug = (() => Promise.reject(new RangeError("bug"))) as FetchFn;
  await assertRejects(() => run(bug), RangeError);
});
