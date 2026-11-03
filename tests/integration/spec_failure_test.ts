import { assertEquals, assertStringIncludes } from "@std/assert";
import { runSpec, type SpecDeps } from "../../src/cli/handlers/spec_handler.ts";
import { InvalidApiUrl } from "../../src/domain/cloud/cloud_config.ts";
import { makeSpecSession } from "../../src/domain/cloud/spec_session.ts";
import type { FetchFn } from "../../src/domain/cloud/cloud_client.ts";
import type { CredentialStore } from "../../src/domain/cloud/credentials.ts";
import type { SpecCacheStore } from "../../src/application/ports.ts";
import type { SpecStep } from "../../src/domain/spec/spec_step.ts";

// cli#736 — a spec command says what failed: a refused api_url, or a redirect, which
// is no outage. It reuses no cache and tells nobody to check their connection.

const STEP: SpecStep = { key: "plan", name: "Plan", order: 1, body: "x" };

function cacheOf(steps: SpecStep[] | null): SpecCacheStore {
  return {
    read: () => Promise.resolve(steps),
    write: () => Promise.reject(new Error("nothing to write")),
  } as unknown as SpecCacheStore;
}

function deps(over: Partial<SpecDeps>) {
  const err: string[] = [];
  const all: SpecDeps = {
    out: () => {},
    err: (s) => err.push(s),
    projectDir: ".",
    readSpecBackend: () => Promise.resolve("cloud"),
    buildSession: () => Promise.resolve(null),
    cache: cacheOf(null),
    ...over,
  };
  return { all, err };
}

const session = (store: CredentialStore) =>
  makeSpecSession({
    config: { apiUrl: "https://cloud.example.test", projectKey: "CLOUD" },
    store,
    fetchFn: (() => Promise.resolve(new Response("{}", { status: 307 }))) as FetchFn,
    env: () => undefined,
  });

const login = (accessExpiresAt: number): CredentialStore => ({
  kind: "file",
  load: () => Promise.resolve({ accessToken: "A", refreshToken: "R", accessExpiresAt }),
  save: () => Promise.resolve(),
  delete: () => Promise.reject(new Error("the login must be kept")),
});

Deno.test("spec: a refused api_url is the handler's own message and exit 1", async () => {
  const { all, err } = deps({ buildSession: () => Promise.reject(new InvalidApiUrl()) });
  assertEquals(await runSpec({ kind: "spec", sub: "pull", task: 1, apiUrl: null }, all), 1);
  assertStringIncludes(err.join("\n"), "invalid Specnaut Cloud API URL");
});

// A live token meets the redirect on the request; an expired one, on its refresh.
for (const [when, expiry] of [["request", 8.64e15], ["refresh", 0]] as const) {
  for (const steps of [null, [STEP]]) {
    const cached = steps ? "with a cache" : "with no cache";
    Deno.test(`spec pull: a redirect on the ${when}, ${cached}, exits 5 and says so`, async () => {
      const { all, err } = deps({
        buildSession: () => Promise.resolve(session(login(expiry))),
        cache: cacheOf(steps),
      });
      assertEquals(await runSpec({ kind: "spec", sub: "pull", task: 7, apiUrl: null }, all), 5);
      const text = err.join("\n");
      assertStringIncludes(text, "redirected the request");
      assertEquals(/connection|retry|unknown|reusing/.test(text), false, text);
    });
  }

  Deno.test(`spec push: a redirect on the ${when} exits 5 and says so`, async () => {
    const { all, err } = deps({
      buildSession: () => Promise.resolve(session(login(expiry))),
      cache: cacheOf([STEP]),
    });
    assertEquals(await runSpec({ kind: "spec", sub: "push", task: 7, apiUrl: null }, all), 5);
    const text = err.join("\n");
    assertStringIncludes(text, "redirected the request");
    assertEquals(/connection|retry|unknown/.test(text), false, text);
  });
}
