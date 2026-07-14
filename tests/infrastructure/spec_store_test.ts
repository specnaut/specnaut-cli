import { assertEquals, assertRejects } from "@std/assert";
import { CloudSpecStore } from "../../src/infrastructure/spec/cloud_spec_store.ts";
import { LocalSpecStore } from "../../src/infrastructure/spec/local_spec_store.ts";
import { makeSpecSession } from "../../src/domain/cloud/spec_session.ts";
import type { FetchFn } from "../../src/domain/cloud/cloud_client.ts";
import type { CredentialStore } from "../../src/infrastructure/credential_store.ts";

// Spec 020 / FR-002 — the SpecStore adapters. CloudSpecStore.pull delegates to a
// (fake-fetch) session; LocalSpecStore's cloud-only verbs reject with one clear
// message so a misdirected call never silently succeeds.

const API = "https://dep.convex.site";

const stubStore: CredentialStore = {
  kind: "file",
  load: () => Promise.resolve(null),
  save: () => Promise.resolve(),
  delete: () => Promise.resolve(),
};

function cloudStore(fetchFn: FetchFn) {
  const session = makeSpecSession({
    config: { apiUrl: API, projectKey: "CLOUD" },
    store: stubStore,
    fetchFn,
    env: (k) => (k === "SPECNAUT_CLOUD_TOKEN" ? "headless-token" : undefined),
  })!;
  return new CloudSpecStore(session);
}

function jsonFetch(status: number, body: unknown): FetchFn {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    )) as FetchFn;
}

Deno.test("CloudSpecStore.pull returns the task's steps (sorted)", async () => {
  const store = cloudStore(jsonFetch(200, {
    spec: {
      taskNumber: 154,
      title: "t",
      steps: [
        { key: "plan", name: "Plan", order: 2, body: "b2" },
        { key: "specify", name: "Specify", order: 1, body: "b1" },
      ],
    },
  }));
  const steps = await store.pull(154);
  assertEquals(steps?.map((s) => s.key), ["specify", "plan"]);
});

Deno.test("CloudSpecStore.pull returns null when the task has no cloud spec", async () => {
  const store = cloudStore(jsonFetch(200, { spec: null }));
  assertEquals(await store.pull(154), null);
});

Deno.test("CloudSpecStore.push upserts without throwing on 200", async () => {
  const store = cloudStore(jsonFetch(200, {}));
  await store.push(154, [{ key: "specify", name: "Specify", order: 1, body: "b" }]);
});

Deno.test("LocalSpecStore.pull rejects with a clear cloud-only message", async () => {
  const err = await assertRejects(() => new LocalSpecStore().pull(1), Error);
  assertEquals(err.message.includes("cloud-backend commands"), true);
  assertEquals(err.message.includes("local spec backend"), true);
});

Deno.test("LocalSpecStore.push rejects with a clear cloud-only message", async () => {
  const err = await assertRejects(
    () => new LocalSpecStore().push(1, [{ key: "specify", name: "Specify", order: 1, body: "b" }]),
    Error,
  );
  assertEquals(err.message.includes("cloud-backend commands"), true);
});

Deno.test("LocalSpecStore advertises the local key", () => {
  assertEquals(new LocalSpecStore().key, "local");
});
