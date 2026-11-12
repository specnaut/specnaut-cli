import { assertEquals, assertRejects } from "@std/assert";
import { PATTERNS } from "../domain/cloud_patterns_fixture.ts";
import { runSpec, type SpecIntent } from "../../src/cli/handlers/spec_handler.ts";
import { type GateIntent, runGate } from "../../src/cli/handlers/gate_handler.ts";
import { SpecSession } from "../../src/domain/cloud/spec_session.ts";
import { SpecClient } from "../../src/domain/cloud/spec_client.ts";
import { CloudClient, type FetchFn } from "../../src/domain/cloud/cloud_client.ts";
import { GateClient } from "../../src/domain/cloud/gate_client.ts";
import { GateSession } from "../../src/domain/cloud/gate_session.ts";
import type { SpecStep } from "../../src/domain/spec/spec_step.ts";
import type { SpecBackend } from "../../src/domain/installed_lock.ts";
import { bindingClient } from "../../src/cli/handlers/cloud_project_binding.ts";
import { CredentialRefused } from "../../src/domain/cloud/credential_check.ts";

/**
 * `spec push` and `gate raise` with a credential in what they would send: the command
 * says which field and which class, exits 1, makes no request, and prints no value.
 */

const API = "https://api.example.com";
const VALUE = `gh${"p"}_${"a".repeat(36)}`;

function recording() {
  const out: string[] = [];
  const err: string[] = [];
  let calls = 0;
  const fetchFn = (() => {
    calls++;
    return Promise.resolve(new Response("{}", { status: 500 }));
  }) as FetchFn;
  return { out, err, fetchFn, calls: () => calls };
}

Deno.test("spec push refuses a step that holds a credential, and sends nothing", async () => {
  const r = recording();
  const steps: SpecStep[] = [{ key: "plan", name: "Plan", order: 1, body: `Use ${VALUE}.` }];
  const session = new SpecSession({
    projectKey: "ACME",
    client: new SpecClient(API, r.fetchFn, PATTERNS),
    cloudClient: new CloudClient(API, r.fetchFn, PATTERNS),
    token: () => Promise.resolve("tok"),
  });
  const intent: SpecIntent = { kind: "spec", sub: "push", task: 7, apiUrl: null };
  const code = await runSpec(intent, {
    out: (s) => r.out.push(s),
    err: (s) => r.err.push(s),
    projectDir: "/nonexistent",
    readSpecBackend: () => Promise.resolve("cloud" as SpecBackend),
    buildSession: () => Promise.resolve(session),
    cache: {
      read: () => Promise.resolve(steps),
      write: () => Promise.resolve([]),
      clear: () => Promise.resolve(),
    },
  });
  assertEquals([code, r.calls(), r.out], [1, 0, []]);
  assertEquals(r.err.length, 1);
  assertEquals(/step 1 body.*\(token\)/.test(r.err[0]), true, r.err[0]);
  assertEquals(r.err[0].includes(VALUE), false);
});

Deno.test("gate raise refuses a title that holds a credential, and sends nothing", async () => {
  const r = recording();
  const session = new GateSession({
    projectKey: "ACME",
    client: new GateClient(API, r.fetchFn, PATTERNS),
    remote: { enabled: true, awaitTimeoutMs: 60_000, pollIntervalMs: 5_000 },
    token: () => Promise.resolve("tok"),
    now: () => 0,
    sleep: () => Promise.resolve(),
  });
  const intent: GateIntent = {
    kind: "gate",
    sub: "raise",
    apiUrl: null,
    type: "decision",
    title: `Rotate ${VALUE}?`,
    payload: '{"question":"q","options":[{"id":"A","label":"Yes"}]}',
    task: null,
    id: null,
  };
  const code = await runGate(intent, {
    out: (s) => r.out.push(s),
    err: (s) => r.err.push(s),
    buildSession: () => Promise.resolve(session),
  });
  assertEquals([code, r.calls(), r.out], [1, 0, []]);
  assertEquals(r.err.length, 1);
  assertEquals(/gate title.*\(token\)/.test(r.err[0]), true, r.err[0]);
  assertEquals(r.err[0].includes(VALUE), false);
});

Deno.test("the client login binds with checks the name against patterns and the stored login", async () => {
  // Refused before any request, so the real fetch this client holds is never called.
  const refresh = crypto.randomUUID();
  const { client, store } = bindingClient(API, {
    kind: "file",
    load: () => Promise.resolve({ accessToken: "a", refreshToken: refresh, accessExpiresAt: 0 }),
    save: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  });
  const named = await assertRejects(
    () => client.createProject("tok", "ACME", `Acme ${VALUE}`),
    CredentialRefused,
  );
  assertEquals([named.field, named.kind], ["project name", "token"]);
  await store.load(API); // the login, as `cloud login` reads it before binding
  const held = await assertRejects(
    () => client.createProject("tok", "ACME", `Acme ${refresh}`),
    CredentialRefused,
  );
  assertEquals([held.field, held.kind], ["project name", "session"]);
});

Deno.test("a client handed no patterns sends no written text at all", async () => {
  const r = recording();
  await assertRejects(() => new CloudClient(API, r.fetchFn).createTask("tok", "ACME", "Clean"));
  await assertRejects(() => new SpecClient(API, r.fetchFn).putSteps("tok", "ACME", 1, []));
  assertEquals(r.calls(), 0);
});
