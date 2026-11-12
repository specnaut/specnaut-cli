import { assertEquals } from "@std/assert";
import { PULL_STALE_CACHE, runSpec, type SpecDeps } from "../../src/cli/handlers/spec_handler.ts";
import { makeSpecSession, SpecSession } from "../../src/domain/cloud/spec_session.ts";
import type { SpecClient } from "../../src/domain/cloud/spec_client.ts";
import { SpecCacheWriter } from "../../src/infrastructure/spec/spec_cache_writer.ts";
import { type CloudClient, type FetchFn, PATTERNS } from "../domain/cloud_patterns_fixture.ts";
import type { CredentialStore } from "../../src/domain/cloud/credentials.ts";
import type { SpecBackend } from "../../src/domain/installed_lock.ts";

// Spec 020 / US3 + US4 — the full author → pull → edit → push loop through the
// `spec` handler: `pull` materialises the cloud spec into the gitignored cache,
// an edit to a cached tab is picked up by `push`, and untouched tabs are carried
// through unchanged (upsert-only). Also covers the local-backend gate + the
// offline cache-reuse fallback (FR-008).

const API = "https://api.example.com";

const stubStore: CredentialStore = {
  kind: "file",
  load: () => Promise.resolve(null),
  save: () => Promise.resolve(),
  delete: () => Promise.resolve(),
};

function sessionWith(fetchFn: FetchFn): SpecSession {
  return makeSpecSession({
    config: { apiUrl: API, projectKey: "CLOUD" },
    store: stubStore,
    fetchFn,
    patterns: PATTERNS,
    // The test deployment is named by the environment, so the headless token may go there.
    env: (k) => ({ SPECNAUT_CLOUD_TOKEN: "headless-token", SPECNAUT_CLOUD_API_URL: API })[k],
  })!;
}

function deps(over: Partial<SpecDeps>): { deps: SpecDeps; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const base: SpecDeps = {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    projectDir: "/nonexistent",
    readSpecBackend: () => Promise.resolve("cloud" as SpecBackend),
    buildSession: () => Promise.resolve(null),
    cache: new SpecCacheWriter(),
    ...over,
  };
  return { deps: base, out, err };
}

async function withTmp(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "spec_pushpull_" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("edit a materialised tab → push → cloud reflects it; untouched tabs preserved", async () => {
  await withTmp(async (dir) => {
    const pushBodies: string[] = [];
    // GET for the pull; PUT captures the pushed payload for the push.
    const fetchFn = ((_input: string | URL | Request, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              spec: {
                taskNumber: 154,
                title: "t",
                steps: [
                  { key: "specify", name: "Specify", order: 1, body: "orig-specify" },
                  { key: "plan", name: "Plan", order: 2, body: "orig-plan" },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      pushBodies.push(init?.body as string);
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as FetchFn;

    const session = sessionWith(fetchFn);
    const cache = new SpecCacheWriter();

    // 1. pull → materialise both tabs into the gitignored cache.
    const pull = deps({ projectDir: dir, cache, buildSession: () => Promise.resolve(session) });
    assertEquals(
      await runSpec({ kind: "spec", sub: "pull", task: 154, apiUrl: null }, pull.deps),
      0,
    );
    assertEquals(
      await Deno.readTextFile(`${dir}/.specnaut/specs/.cache/154/1-specify.md`),
      "orig-specify",
    );

    // 2. edit one tab locally.
    await Deno.writeTextFile(`${dir}/.specnaut/specs/.cache/154/1-specify.md`, "EDITED-specify");

    // 3. push → the edited tab AND the untouched tab both travel upsert.
    const push = deps({ projectDir: dir, cache, buildSession: () => Promise.resolve(session) });
    assertEquals(
      await runSpec({ kind: "spec", sub: "push", task: 154, apiUrl: null }, push.deps),
      0,
    );

    const sent = JSON.parse(pushBodies[0]);
    const bodies = Object.fromEntries(
      sent.steps.map((s: { key: string; body: string }) => [s.key, s.body]),
    );
    assertEquals(bodies.specify, "EDITED-specify"); // the edit is reflected
    assertEquals(bodies.plan, "orig-plan"); // the untouched tab is preserved
  });
});

Deno.test("spec pull with no spec on Cloud reports cleanly (exit 0, not a crash)", async () => {
  await withTmp(async (dir) => {
    const session = sessionWith(
      (() =>
        Promise.resolve(new Response(JSON.stringify({ spec: null }), { status: 200 }))) as FetchFn,
    );
    const { deps: d, out } = deps({
      projectDir: dir,
      buildSession: () => Promise.resolve(session),
    });
    assertEquals(await runSpec({ kind: "spec", sub: "pull", task: 9, apiUrl: null }, d), 0);
    assertEquals(out.join("\n").includes("no spec for task 9"), true);
  });
});

Deno.test("spec commands under the local backend exit 1 with a clear message", async () => {
  const { deps: d, err } = deps({ readSpecBackend: () => Promise.resolve("local" as SpecBackend) });
  assertEquals(await runSpec({ kind: "spec", sub: "pull", task: 1, apiUrl: null }, d), 1);
  assertEquals(err.join("\n").includes("cloud-backend commands"), true);
});

Deno.test("spec pull falls back to an existing cache when Cloud is unreachable (FR-008)", async () => {
  await withTmp(async (dir) => {
    const cache = new SpecCacheWriter();
    // Seed a prior cache, then simulate a network failure on the fresh pull.
    await cache.write(dir, 154, [{ key: "specify", name: "Specify", order: 1, body: "cached" }]);
    const session = sessionWith((() => Promise.reject(new TypeError("offline"))) as FetchFn);
    const { deps: d, err, out } = deps({
      projectDir: dir,
      cache,
      buildSession: () => Promise.resolve(session),
    });
    // Its own exit, not a fresh pull's 0: a push from this cache would
    // overwrite every tab on Cloud with what may be stale (cli#732).
    assertEquals(
      await runSpec({ kind: "spec", sub: "pull", task: 154, apiUrl: null }, d),
      PULL_STALE_CACHE,
    );
    assertEquals(PULL_STALE_CACHE, 6);
    assertEquals(err.join("\n").includes("reusing the existing cache"), true);
    // The cache is left as it was, and the run says what it kept.
    assertEquals(
      await Deno.readTextFile(`${dir}/.specnaut/specs/.cache/154/1-specify.md`),
      "cached",
    );
    assertEquals(out.join("\n").includes("1 cached step(s)"), true);
  });
});

Deno.test("spec pull with a broken connection and NO cache exits 5 with an actionable message", async () => {
  await withTmp(async (dir) => {
    const session = sessionWith((() => Promise.reject(new TypeError("offline"))) as FetchFn);
    const { deps: d, err } = deps({
      projectDir: dir,
      buildSession: () => Promise.resolve(session),
    });
    assertEquals(await runSpec({ kind: "spec", sub: "pull", task: 154, apiUrl: null }, d), 5);
    assertEquals(err.join("\n").includes("retry"), true);
  });
});

// cli#733 — the fallback is for an unreachable Cloud only. An answer Cloud gave
// is not "unreachable": with a cache present it still exits 5, the cache untouched.
// cli#734: an unlisted 4xx (400, 429) is an answer too, never "transient".
for (const status of [400, 401, 403, 409, 422, 429]) {
  Deno.test(`spec pull answered ${status} with a cache present exits 5, never the stale-cache 6`, async () => {
    await withTmp(async (dir) => {
      const cache = new SpecCacheWriter();
      await cache.write(dir, 154, [{ key: "specify", name: "Specify", order: 1, body: "cached" }]);
      const session = sessionWith(
        (() => Promise.resolve(new Response("{}", { status }))) as FetchFn,
      );
      const { deps: d, err } = deps({
        projectDir: dir,
        cache,
        buildSession: () => Promise.resolve(session),
      });
      assertEquals(await runSpec({ kind: "spec", sub: "pull", task: 154, apiUrl: null }, d), 5);
      assertEquals(err.join("\n").includes("reusing the existing cache"), false);
      if (status === 403) assertEquals(err.join("\n").includes("not allowed to pull spec"), true);
      assertEquals(
        await Deno.readTextFile(`${dir}/.specnaut/specs/.cache/154/1-specify.md`),
        "cached",
      );
    });
  });
}

Deno.test("spec pull answered 503 with a cache present is unreachable: the stale-cache 6", async () => {
  await withTmp(async (dir) => {
    const cache = new SpecCacheWriter();
    await cache.write(dir, 154, [{ key: "specify", name: "Specify", order: 1, body: "cached" }]);
    const session = sessionWith(
      (() => Promise.resolve(new Response("{}", { status: 503 }))) as FetchFn,
    );
    const { deps: d } = deps({
      projectDir: dir,
      cache,
      buildSession: () => Promise.resolve(session),
    });
    assertEquals(
      await runSpec({ kind: "spec", sub: "pull", task: 154, apiUrl: null }, d),
      PULL_STALE_CACHE,
    );
  });
});

// cli#734 — through the real refresh path: an expired token whose refresh cannot
// reach Cloud, or meets a failing one, is unreachable — exit 6 — and the stored
// credentials survive it for the next attempt.
for (
  const [why, refresh] of [
    ["cannot reach Cloud", () => Promise.reject(new TypeError("offline"))],
    ["meets a 503", () => Promise.resolve(new Response("{}", { status: 503 }))],
  ] as const
) {
  Deno.test(`spec pull whose token refresh ${why} exits 6 and keeps the credentials`, async () => {
    await withTmp(async (dir) => {
      const cache = new SpecCacheWriter();
      await cache.write(dir, 154, [{ key: "specify", name: "Specify", order: 1, body: "cached" }]);
      let deleted = false;
      const store: CredentialStore = {
        ...stubStore,
        load: () => Promise.resolve({ accessToken: "A", refreshToken: "R", accessExpiresAt: 0 }),
        delete: () => Promise.resolve(void (deleted = true)),
      };
      const fetchFn = ((url: string) =>
        url.endsWith("/auth/refresh") ? refresh() : Promise.reject(new Error(url))) as FetchFn;
      const session = makeSpecSession({
        config: { apiUrl: API, projectKey: "CLOUD" },
        store,
        fetchFn,
        env: () =>
          undefined,
      })!;
      const { deps: d } = deps({
        projectDir: dir,
        cache,
        buildSession: () => Promise.resolve(session),
      });
      assertEquals(
        await runSpec({ kind: "spec", sub: "pull", task: 154, apiUrl: null }, d),
        PULL_STALE_CACHE,
      );
      assertEquals(deleted, false, "a transient refresh failure must not drop the credentials");
    });
  });
}

Deno.test("spec pull whose token provider throws a TypeError is no network failure: exit 5", async () => {
  await withTmp(async (dir) => {
    const cache = new SpecCacheWriter();
    await cache.write(dir, 154, [{ key: "specify", name: "Specify", order: 1, body: "cached" }]);
    // A bug in the provider, not Cloud unreachable: it must not take the stale cache.
    const session = new SpecSession({
      projectKey: "CLOUD",
      client: {} as SpecClient,
      cloudClient: {} as CloudClient,
      token: () => Promise.reject(new TypeError("undefined is not a function")),
    });
    const { deps: d, err } = deps({
      projectDir: dir,
      cache,
      buildSession: () => Promise.resolve(session),
    });
    assertEquals(await runSpec({ kind: "spec", sub: "pull", task: 154, apiUrl: null }, d), 5);
    assertEquals(err.join("\n").includes("reusing the existing cache"), false);
  });
});
