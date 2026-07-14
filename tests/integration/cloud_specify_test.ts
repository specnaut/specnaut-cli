import { assertEquals } from "@std/assert";
import { makeSpecSession } from "../../src/domain/cloud/spec_session.ts";
import type { FetchFn } from "../../src/domain/cloud/cloud_client.ts";
import type { CredentialStore } from "../../src/infrastructure/credential_store.ts";
import type { SpecStep } from "../../src/domain/spec/spec_step.ts";

// Spec 020 / SC-003 / FR-011 — cloud-mode `specify` authoring. Driving
// SpecSession.author with a fake fetch in a throwaway project dir proves the
// compiled path: it pushes steps to Cloud, auto-creates + links a task when none
// is linked, and touches NO `.specnaut/specs/` files and NO git branch (the
// session has no filesystem/git dependency — those side effects live only on the
// local path).

const API = "https://dep.convex.site";

type Route = { method: string; match: (u: string) => boolean; status: number; body: unknown };

function scripted(routes: Route[]) {
  const calls: { method: string; url: string; body: string | null }[] = [];
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: (init?.body as string) ?? null });
    const r = routes.find((x) => x.method === method && x.match(url));
    if (!r) throw new Error(`no route for ${method} ${url}`);
    return Promise.resolve(
      new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as FetchFn;
  return { fetchFn, calls };
}

// A stub credential store — never consulted, because the headless-token env seam
// short-circuits the refresh path in makeSpecSession.
const stubStore: CredentialStore = {
  kind: "file",
  load: () => Promise.resolve(null),
  save: () => Promise.resolve(),
  delete: () => Promise.resolve(),
};

function sessionWith(fetchFn: FetchFn) {
  const session = makeSpecSession({
    config: { apiUrl: API, projectKey: "CLOUD" },
    store: stubStore,
    fetchFn,
    env: (k) => (k === "SPECNAUT_CLOUD_TOKEN" ? "headless-token" : undefined),
  });
  if (!session) throw new Error("expected a cloud-linked session");
  return session;
}

const STEPS: SpecStep[] = [
  { key: "specify", name: "Specify", order: 1, body: "# spec" },
];

Deno.test("cloud specify with NO linked task auto-creates + links one, then pushes (FR-011)", async () => {
  const { fetchFn, calls } = scripted([
    {
      method: "POST",
      match: (u) => u.endsWith("/tasks"),
      status: 201,
      body: { task: { number: 207 } },
    },
    {
      method: "POST",
      match: (u) => u.endsWith("/specs"),
      status: 201,
      body: { spec: { taskNumber: 207, title: "Feature X", steps: [] } },
    },
    { method: "PUT", match: (u) => u.endsWith("/specs/steps"), status: 200, body: {} },
  ]);
  const result = await sessionWith(fetchFn).author(null, "Feature X", STEPS);

  assertEquals(result.created, true);
  assertEquals(result.taskNumber, 207);
  assertEquals(result.pushed, 1);
  // The task was created from the title, then the spec was attached + pushed.
  assertEquals(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), [
    "POST /api/v1/tasks",
    "POST /api/v1/specs",
    "PUT /api/v1/specs/steps",
  ]);
  const created = JSON.parse(calls[0].body!);
  assertEquals(created.projectKey, "CLOUD");
  assertEquals(created.title, "Feature X");
});

Deno.test("cloud specify with an explicit task attaches to it (no auto-create)", async () => {
  const { fetchFn, calls } = scripted([
    {
      method: "POST",
      match: (u) => u.endsWith("/specs"),
      status: 200,
      body: { spec: { taskNumber: 154, title: "t", steps: [] } },
    },
    { method: "PUT", match: (u) => u.endsWith("/specs/steps"), status: 200, body: {} },
  ]);
  const result = await sessionWith(fetchFn).author(154, "t", STEPS);
  assertEquals(result.created, false);
  assertEquals(result.taskNumber, 154);
  assertEquals(calls.some((c) => c.url.endsWith("/tasks")), false);
});

Deno.test("cloud specify writes ZERO .specnaut/specs files and creates ZERO branches (SC-003)", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "cloud_specify_" });
  try {
    await Deno.mkdir(`${tmp}/.specnaut`, { recursive: true });
    const { fetchFn } = scripted([
      {
        method: "POST",
        match: (u) => u.endsWith("/tasks"),
        status: 201,
        body: { task: { number: 5 } },
      },
      {
        method: "POST",
        match: (u) => u.endsWith("/specs"),
        status: 201,
        body: { spec: { taskNumber: 5, title: "t", steps: [] } },
      },
      { method: "PUT", match: (u) => u.endsWith("/specs/steps"), status: 200, body: {} },
    ]);
    await sessionWith(fetchFn).author(null, "t", STEPS);

    // The authoring path never materialises a spec directory…
    let specsExists = true;
    try {
      await Deno.stat(`${tmp}/.specnaut/specs`);
    } catch {
      specsExists = false;
    }
    assertEquals(specsExists, false);
    // …and never creates a git repo / branch.
    let gitExists = true;
    try {
      await Deno.stat(`${tmp}/.git`);
    } catch {
      gitExists = false;
    }
    assertEquals(gitExists, false);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
