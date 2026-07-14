import { assertEquals } from "@std/assert";
import { runSpec, type SpecDeps } from "../../src/cli/handlers/spec_handler.ts";
import { makeSpecSession, type SpecSession } from "../../src/domain/cloud/spec_session.ts";
import { SpecCacheWriter } from "../../src/infrastructure/spec/spec_cache_writer.ts";
import type { FetchFn } from "../../src/domain/cloud/cloud_client.ts";
import type { CredentialStore } from "../../src/infrastructure/credential_store.ts";
import type { SpecBackend } from "../../src/domain/installed_lock.ts";

// Spec 020 / US3 + US4 — the full author → pull → edit → push loop through the
// `spec` handler: `pull` materialises the cloud spec into the gitignored cache,
// an edit to a cached tab is picked up by `push`, and untouched tabs are carried
// through unchanged (upsert-only). Also covers the local-backend gate + the
// offline cache-reuse fallback (FR-008).

const API = "https://dep.convex.site";

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
    env: (k) => (k === "SPECNAUT_CLOUD_TOKEN" ? "headless-token" : undefined),
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
    assertEquals(await runSpec({ kind: "spec", sub: "pull", task: 154, apiUrl: null }, pull.deps), 0);
    assertEquals(await Deno.readTextFile(`${dir}/.specnaut/specs/.cache/154/1-specify.md`), "orig-specify");

    // 2. edit one tab locally.
    await Deno.writeTextFile(`${dir}/.specnaut/specs/.cache/154/1-specify.md`, "EDITED-specify");

    // 3. push → the edited tab AND the untouched tab both travel upsert.
    const push = deps({ projectDir: dir, cache, buildSession: () => Promise.resolve(session) });
    assertEquals(await runSpec({ kind: "spec", sub: "push", task: 154, apiUrl: null }, push.deps), 0);

    const sent = JSON.parse(pushBodies[0]);
    const bodies = Object.fromEntries(sent.steps.map((s: { key: string; body: string }) => [s.key, s.body]));
    assertEquals(bodies.specify, "EDITED-specify"); // the edit is reflected
    assertEquals(bodies.plan, "orig-plan"); // the untouched tab is preserved
  });
});

Deno.test("spec pull with no spec on Cloud reports cleanly (exit 0, not a crash)", async () => {
  await withTmp(async (dir) => {
    const session = sessionWith(
      (() => Promise.resolve(new Response(JSON.stringify({ spec: null }), { status: 200 }))) as FetchFn,
    );
    const { deps: d, out } = deps({ projectDir: dir, buildSession: () => Promise.resolve(session) });
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
    const { deps: d, err } = deps({ projectDir: dir, cache, buildSession: () => Promise.resolve(session) });
    assertEquals(await runSpec({ kind: "spec", sub: "pull", task: 154, apiUrl: null }, d), 0);
    assertEquals(err.join("\n").includes("reusing the existing cache"), true);
  });
});

Deno.test("spec pull with a broken connection and NO cache exits 5 with an actionable message", async () => {
  await withTmp(async (dir) => {
    const session = sessionWith((() => Promise.reject(new TypeError("offline"))) as FetchFn);
    const { deps: d, err } = deps({ projectDir: dir, buildSession: () => Promise.resolve(session) });
    assertEquals(await runSpec({ kind: "spec", sub: "pull", task: 154, apiUrl: null }, d), 5);
    assertEquals(err.join("\n").includes("retry"), true);
  });
});
