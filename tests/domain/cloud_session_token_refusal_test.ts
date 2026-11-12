import { assertEquals, assertRejects } from "@std/assert";
import { CloudClient } from "../../src/domain/cloud/cloud_client.ts";
import { SpecClient } from "../../src/domain/cloud/spec_client.ts";
import { GateClient } from "../../src/domain/cloud/gate_client.ts";
import { CredentialRefused } from "../../src/domain/cloud/credential_check.ts";
import { type CloudCredentials, watchedStore } from "../../src/domain/cloud/credentials.ts";
import { type FetchFn, PATTERNS } from "./cloud_patterns_fixture.ts";
import { makeSpecSession } from "../../src/domain/cloud/spec_session.ts";
import { makeGateSession } from "../../src/domain/cloud/gate_session.ts";

/**
 * A field that carries the session's own token is refused before any request, whatever
 * the token looks like: no pattern knows the shape of a Specnaut Cloud token. The token
 * is compared in memory and never named in the refusal.
 */

const API = "https://api.example.com";

/** A token of no known shape: only the session knows it is one. */
const BEARER = crypto.randomUUID();
const REFRESH = crypto.randomUUID();

function counting(): { fetchFn: FetchFn; calls: () => number } {
  let n = 0;
  const fetchFn = (() => (n++, Promise.reject(new Error("no request may be made")))) as FetchFn;
  return { fetchFn, calls: () => n };
}

/** Each write, sending `text` under the bearer `token`, with `held` as what else the session holds. */
const WRITES: Record<
  string,
  (f: FetchFn, held: string[], token: string, text: string) => Promise<unknown>
> = {
  "task title": (f, held, token, text) =>
    new CloudClient(API, f, PATTERNS, () => held).createTask(token, "ACME", text),
  "step 1 body": (f, held, token, text) =>
    new SpecClient(API, f, PATTERNS, () => held).putSteps(token, "ACME", 1, [
      { key: "plan", name: "Plan", order: 1, body: text },
    ]),
  "gate title": (f, held, token, text) =>
    new GateClient(API, f, PATTERNS, () => held).open(token, {
      projectKey: "ACME",
      type: "decision",
      title: text,
      payload: {},
    }),
};

for (const [field, write] of Object.entries(WRITES)) {
  Deno.test(`the bearer token in the ${field} is refused before any request`, async () => {
    const { fetchFn, calls } = counting();
    const e = await assertRejects(
      () => write(fetchFn, [], BEARER, `see ${BEARER}`),
      CredentialRefused,
    );
    assertEquals([e.field, e.kind, calls()], [field, "session", 0]);
    assertEquals(e.message.includes(BEARER), false);
  });

  Deno.test(`the stored refresh token in the ${field} is refused before any request`, async () => {
    const { fetchFn, calls } = counting();
    const e = await assertRejects(
      () => write(fetchFn, [REFRESH], BEARER, `see ${REFRESH}`),
      CredentialRefused,
    );
    assertEquals([e.field, e.kind, calls()], [field, "session", 0]);
    assertEquals(e.message.includes(REFRESH), false);
  });
}

Deno.test("a short token is not compared: it would match ordinary words", async () => {
  const { fetchFn, calls } = counting();
  await assertRejects(
    () => WRITES["task title"](fetchFn, ["plan"], "tok", "the plan"),
    Error,
    "no request",
  );
  assertEquals(calls(), 1);
});

Deno.test("a watched store holds every token it loaded or saved, and passes them through", async () => {
  const loaded: CloudCredentials = {
    accessToken: "access-1",
    refreshToken: REFRESH,
    accessExpiresAt: 0,
  };
  const saved: CloudCredentials = {
    accessToken: BEARER,
    refreshToken: "refresh-2",
    accessExpiresAt: 0,
  };
  const writes: CloudCredentials[] = [];
  const { store, held } = watchedStore({
    kind: "file",
    load: () => Promise.resolve(loaded),
    save: (_u, c) => Promise.resolve(void writes.push(c)),
    delete: () => Promise.resolve(),
  });
  assertEquals(held(), []);
  assertEquals(await store.load(API), loaded);
  await store.save(API, saved);
  assertEquals([[...held()].sort(), writes], [[REFRESH, "access-1", BEARER, "refresh-2"].sort(), [
    saved,
  ]]);
});

/** A stored login still valid for an hour: the session signs in with no request. */
const LOGIN = {
  kind: "file" as const,
  load: () =>
    Promise.resolve({
      accessToken: BEARER,
      refreshToken: REFRESH,
      accessExpiresAt: Date.now() + 3_600_000,
    }),
  save: () => Promise.resolve(),
  delete: () => Promise.resolve(),
};
const CONFIG = { apiUrl: API, projectKey: "ACME", remote: { enabled: true } };

Deno.test("a spec session refuses a step carrying its stored refresh token, unsent", async () => {
  const { fetchFn, calls } = counting();
  const s = makeSpecSession({
    config: CONFIG,
    store: LOGIN,
    patterns: PATTERNS,
    fetchFn,
    env: () => undefined,
  })!;
  const step = { key: "plan", name: "Plan", order: 1, body: `use ${REFRESH}` };
  const e = await assertRejects(() => s.push(1, [step]), CredentialRefused);
  assertEquals([e.field, e.kind, calls()], ["step 1 body", "session", 0]);
});

Deno.test("a gate session refuses a title carrying its stored refresh token, unsent", async () => {
  const { fetchFn, calls } = counting();
  const s = makeGateSession({
    config: CONFIG,
    store: LOGIN,
    patterns: PATTERNS,
    fetchFn,
    env: () => undefined,
  })!;
  const req = {
    projectKey: "ACME",
    type: "clarification" as const,
    title: `use ${REFRESH}`,
    payload: { question: "q" },
  };
  const e = await assertRejects(() => s.raiseAndAwait(req), CredentialRefused);
  assertEquals([e.field, e.kind, calls()], ["gate title", "session", 0]);
});
