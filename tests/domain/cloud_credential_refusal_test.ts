import { assertEquals, assertRejects } from "@std/assert";
import { PATTERNS } from "./cloud_patterns_fixture.ts";
import { CloudClient, type FetchFn } from "../../src/domain/cloud/cloud_client.ts";
import { SpecClient } from "../../src/domain/cloud/spec_client.ts";
import { GateClient } from "../../src/domain/cloud/gate_client.ts";
import { CredentialRefused } from "../../src/domain/cloud/credential_check.ts";

/**
 * Every call that sends text someone wrote to Specnaut Cloud checks it first: a
 * credential of each class, in each field, is refused with no request made, and the
 * same call with clean text is sent.
 */

const API = "https://api.example.com";

/** One sample per pattern class, assembled at run time: none is a real credential. */
const SAMPLES = [
  { kind: "token", value: `gh${"p"}_${"a".repeat(36)}` },
  { kind: "assignment", value: `pass${"word"}=plainwords1234` },
  { kind: "scheme", value: `Bea${"rer"} abcdefgh12345` },
] as const;

/** A fetch that counts its calls and answers what each call expects to read. */
function counting(): { fetchFn: FetchFn; calls: () => number } {
  let n = 0;
  const body = {
    task: { number: 7 },
    project: { key: "ACME", name: "Acme" },
    spec: { taskNumber: 1, title: "t", steps: [] },
    gate: { id: "g1", state: "open" },
  };
  const fetchFn = (() => {
    n++;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 201 }));
  }) as FetchFn;
  return { fetchFn, calls: () => n };
}

const step = (over: Partial<Record<"key" | "name" | "body", string>> = {}) => ({
  key: "plan",
  name: "Plan",
  order: 1,
  body: "The plan.",
  ...over,
});

/** Each call that sends written text, and the field a given text lands in. */
const CALLS: { field: string; send: (f: FetchFn, text: string) => Promise<unknown> }[] = [
  {
    field: "task title",
    send: (f, t) => new CloudClient(API, f, PATTERNS).createTask("tok", "ACME", t),
  },
  {
    field: "project name",
    send: (f, t) => new CloudClient(API, f, PATTERNS).createProject("tok", "ACME", t),
  },
  {
    field: "project key",
    send: (f, t) => new CloudClient(API, f, PATTERNS).createProject("tok", t, "Acme"),
  },
  {
    field: "spec title",
    send: (f, t) => new SpecClient(API, f, PATTERNS).ensure("tok", "ACME", 1, t),
  },
  {
    field: "step 1 key",
    send: (f, t) => new SpecClient(API, f, PATTERNS).putSteps("tok", "ACME", 1, [step({ key: t })]),
  },
  {
    field: "step 1 name",
    send: (f, t) =>
      new SpecClient(API, f, PATTERNS).putSteps("tok", "ACME", 1, [step({ name: t })]),
  },
  {
    field: "step 2 body",
    send: (f, t) =>
      new SpecClient(API, f, PATTERNS).putSteps("tok", "ACME", 1, [
        step(),
        step({ body: `x\n${t}\n` }),
      ]),
  },
  { field: "gate title", send: (f, t) => gate(f, t, {}) },
  { field: "gate payload", send: (f, t) => gate(f, "Which auth?", { question: t }) },
  {
    field: "gate payload",
    send: (f, t) => gate(f, "Which auth?", { options: [{ id: "A", label: t }] }),
  },
];

function gate(f: FetchFn, title: string, payload: Record<string, unknown>) {
  return new GateClient(API, f, PATTERNS).open("tok", {
    projectKey: "ACME",
    type: "decision",
    title,
    payload,
  });
}

for (const { field, send } of CALLS) {
  for (const { kind, value } of SAMPLES) {
    Deno.test(`a ${kind} in the ${field} is refused before any request`, async () => {
      const { fetchFn, calls } = counting();
      const e = await assertRejects(() => send(fetchFn, `See ${value} here`), CredentialRefused);
      assertEquals([e.field, e.kind, calls()], [field, kind, 0]);
      assertEquals(e.message.includes(value), false, e.message);
    });
  }

  Deno.test(`a clean ${field} is sent, an identifier like task-123 too`, async () => {
    for (const text of ["Export times out on large boards", "task-123"]) {
      const { fetchFn, calls } = counting();
      await send(fetchFn, text);
      assertEquals(calls(), 1, text);
    }
  });
}

Deno.test("a key and value a payload spreads over two strings is still one assignment", async () => {
  const { fetchFn, calls } = counting();
  const e = await assertRejects(
    () => gate(fetchFn, "Which auth?", { [`pass${"word"}`]: "plainwords1234" }),
    CredentialRefused,
  );
  assertEquals([e.field, e.kind, calls()], ["gate payload", "assignment", 0]);
});
