import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { requireCloudToken } from "../../src/cli/handlers/cloud_token.ts";
import { CloudClient } from "../../src/domain/cloud/cloud_client.ts";
import type { CredentialStore } from "../../src/domain/cloud/credentials.ts";

// cli#735 — a logged-in user whose Cloud is down is not told to log in.

const API = "https://cloud.example.com";

function storeWith(login: boolean): CredentialStore {
  return {
    kind: "file",
    load: () =>
      Promise.resolve(login ? { accessToken: "A", refreshToken: "R", accessExpiresAt: 0 } : null),
    save: () => Promise.resolve(),
    delete: () => Promise.reject(new Error("the login must be kept")),
  };
}

async function errorsOf(fetchFn: typeof fetch, store: CredentialStore) {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    const token = await requireCloudToken(API, new CloudClient(API, fetchFn), store);
    return { token, err: lines.join("\n") };
  } finally {
    console.error = original;
  }
}

const unused = (() => Promise.reject(new Error("no request expected"))) as typeof fetch;

Deno.test("requireCloudToken: Cloud unreachable, or failing, is said so — no login prompt", async () => {
  for (
    const fetchFn of [
      () => Promise.reject(new TypeError("offline")),
      () => Promise.resolve(new Response("{}", { status: 503 })),
    ] as (typeof fetch)[]
  ) {
    const { token, err } = await errorsOf(fetchFn, storeWith(true));
    assertEquals(token, null);
    assertStringIncludes(err, "cannot be reached");
    assertEquals(err.includes("login` "), false, err);
    assertEquals(err.includes("not authenticated"), false, err);
  }
});

Deno.test("requireCloudToken: an answer that is no verdict is said so — no login prompt", async () => {
  const proxy = (() => Promise.resolve(new Response("<html>", { status: 200 }))) as typeof fetch;
  const { token, err } = await errorsOf(proxy, storeWith(true));
  assertEquals(token, null);
  assertStringIncludes(err, "answered unexpectedly");
  assertEquals(err.includes("not authenticated"), false, err);
});

Deno.test("requireCloudToken: with no login, it says to log in", async () => {
  const { token, err } = await errorsOf(unused, storeWith(false));
  assertEquals(token, null);
  assertStringIncludes(err, "not authenticated");
  assertStringIncludes(err, "specnaut cloud login");
});

Deno.test("requireCloudToken: a valid login returns its token and prints nothing", async () => {
  const store: CredentialStore = {
    ...storeWith(true),
    load: () => Promise.resolve({ accessToken: "A", refreshToken: "R", accessExpiresAt: 8.64e15 }),
  };
  assertEquals(await errorsOf(unused, store), { token: "A", err: "" });
});

Deno.test("requireCloudToken: an error that is not Cloud's is not dressed up as an outage", async () => {
  const bug = (() => Promise.reject(new RangeError("bug"))) as typeof fetch;
  await assertRejects(() => errorsOf(bug, storeWith(true)), RangeError);
});
