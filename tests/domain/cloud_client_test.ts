import { assertEquals, assertRejects } from "@std/assert";
import { PATTERNS } from "./cloud_patterns_fixture.ts";
import { CloudApiError, CloudClient, isUnavailable } from "../../src/domain/cloud/cloud_client.ts";

const API = "https://api.example.com";

type Call = { url: string; method: string; body: unknown; auth: string | null };

/** Build a fake fetch returning a fixed status+json, recording the request. */
function fakeFetch(status: number, json: unknown) {
  const calls: Call[] = [];
  const fn = ((input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
      auth: headers.get("Authorization"),
    });
    return Promise.resolve(
      new Response(JSON.stringify(json), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { fn, calls };
}

Deno.test("startDevice posts to /auth/device and parses the response", async () => {
  const { fn, calls } = fakeFetch(200, {
    device_code: "sfd_1",
    user_code: "WXYZ-9999",
    verification_uri: `${API}/cli`,
    verification_uri_complete: `${API}/cli?code=WXYZ-9999`,
    expires_in: 900,
    interval: 5,
  });
  const out = await new CloudClient(API, fn).startDevice();
  assertEquals(calls[0].url, `${API}/api/v1/auth/device`);
  assertEquals(calls[0].method, "POST");
  assertEquals(out.userCode, "WXYZ-9999");
  assertEquals(out.verificationUriComplete, `${API}/cli?code=WXYZ-9999`);
  assertEquals(out.intervalS, 5);
});

Deno.test("startDevice clamps server-controlled interval/expiry to safe bounds", async () => {
  const { fn } = fakeFetch(200, {
    device_code: "sfd_1",
    user_code: "AAAA-0000",
    verification_uri: `${API}/cli`,
    interval: 0, // below the 5s floor → clamped up
    expires_in: 99_999_999, // above the 30-min ceiling → clamped down
  });
  const out = await new CloudClient(API, fn).startDevice();
  assertEquals(out.intervalS, 5);
  assertEquals(out.expiresInS, 1800);
});

Deno.test("pollToken maps approved → tokens", async () => {
  const { fn } = fakeFetch(200, {
    status: "approved",
    access_token: "AT",
    refresh_token: "RT",
    expires_in: 3600,
  });
  const out = await new CloudClient(API, fn).pollToken("sfd_1");
  assertEquals(out, {
    status: "approved",
    accessToken: "AT",
    refreshToken: "RT",
    expiresInS: 3600,
  });
});

Deno.test("pollToken maps pending through", async () => {
  const { fn } = fakeFetch(200, { status: "pending" });
  assertEquals(await new CloudClient(API, fn).pollToken("x"), { status: "pending" });
});

Deno.test("refresh ok parses the rotated pair", async () => {
  const { fn, calls } = fakeFetch(200, {
    status: "ok",
    access_token: "AT2",
    refresh_token: "RT2",
    expires_in: 3600,
  });
  const out = await new CloudClient(API, fn).refresh("RT1");
  assertEquals(calls[0].url, `${API}/api/v1/auth/refresh`);
  assertEquals(calls[0].body, { refresh_token: "RT1" });
  assertEquals(out, { status: "ok", accessToken: "AT2", refreshToken: "RT2", expiresInS: 3600 });
});

Deno.test("listProjects sends the bearer token and parses the array", async () => {
  const { fn, calls } = fakeFetch(200, {
    ok: true,
    projects: [{ key: "CLOUD", name: "Cloud", role: "owner" }],
  });
  const out = await new CloudClient(API, fn).listProjects("AT");
  assertEquals(calls[0].url, `${API}/api/v1/projects`);
  assertEquals(calls[0].auth, "Bearer AT");
  assertEquals(out, [{ key: "CLOUD", name: "Cloud", role: "owner" }]);
});

Deno.test("createProject posts key+name and parses the created project", async () => {
  const { fn, calls } = fakeFetch(201, { ok: true, project: { key: "NEW", name: "New" } });
  const out = await new CloudClient(API, fn, PATTERNS).createProject("AT", "new", "New");
  assertEquals(calls[0].method, "POST");
  assertEquals(calls[0].body, { key: "new", name: "New" });
  assertEquals(calls[0].auth, "Bearer AT");
  assertEquals(out.key, "NEW");
});

Deno.test("createProject surfaces a conflict as CloudApiError", async () => {
  const { fn } = fakeFetch(409, { error: "project key NEW already exists" });
  await assertRejects(
    () => new CloudClient(API, fn, PATTERNS).createProject("AT", "NEW", "New"),
    CloudApiError,
    "already exists",
  );
});

Deno.test("listOrgs sends the bearer token and parses the array (#398)", async () => {
  const { fn, calls } = fakeFetch(200, {
    ok: true,
    orgs: [
      { slug: "acme", name: "Acme", role: "owner", isActive: true },
      { slug: "beta", name: "Beta", role: "member", isActive: false },
    ],
  });
  const out = await new CloudClient(API, fn).listOrgs("AT");
  assertEquals(calls[0].url, `${API}/api/v1/orgs`);
  assertEquals(calls[0].method, "GET");
  assertEquals(calls[0].auth, "Bearer AT");
  assertEquals(out, [
    { slug: "acme", name: "Acme", role: "owner", isActive: true },
    { slug: "beta", name: "Beta", role: "member", isActive: false },
  ]);
});

Deno.test("listOrgs surfaces a 401 as CloudApiError (#398)", async () => {
  const { fn } = fakeFetch(401, { error: "unauthorized" });
  await assertRejects(
    () => new CloudClient(API, fn).listOrgs("BAD"),
    CloudApiError,
    "unauthorized",
  );
});

Deno.test("list* strips terminal control characters from server strings (#398 hardening)", async () => {
  const { fn } = fakeFetch(200, {
    ok: true,
    // A hostile/misconfigured API returns ANSI escape + BEL in the org name.
    orgs: [{ slug: "ok", name: "Acme\x1b[31m\x07", role: "owner", isActive: true }],
  });
  const out = await new CloudClient(API, fn).listOrgs("AT");
  // ESC (\x1b) and BEL (\x07) stripped; printable chars preserved.
  assertEquals(out[0].name, "Acme[31m");
});

Deno.test("listColumns passes projectKey in the querystring (#398)", async () => {
  const { fn, calls } = fakeFetch(200, {
    ok: true,
    columns: [{ id: "c1", name: "Todo", order: 1 }],
  });
  const out = await new CloudClient(API, fn).listColumns("AT", "CLOUD");
  assertEquals(calls[0].url, `${API}/api/v1/columns?projectKey=CLOUD`);
  assertEquals(calls[0].auth, "Bearer AT");
  assertEquals(out, [{ id: "c1", name: "Todo", order: 1 }]);
});

Deno.test("listTasks parses tasks and tolerates missing priority/size (#398)", async () => {
  const { fn, calls } = fakeFetch(200, {
    ok: true,
    tasks: [
      { number: 12, title: "Ship it", columnId: "c1", priority: "p1", size: "m" },
      { number: 13, title: "No meta", columnId: "c2" },
    ],
  });
  const out = await new CloudClient(API, fn).listTasks("AT", "CLOUD");
  assertEquals(calls[0].url, `${API}/api/v1/tasks?projectKey=CLOUD`);
  assertEquals(calls[0].auth, "Bearer AT");
  assertEquals(out, [
    { number: 12, title: "Ship it", columnId: "c1", priority: "p1", size: "m" },
    { number: 13, title: "No meta", columnId: "c2", priority: null, size: null },
  ]);
});

// cli#734 — a refresh that cannot reach Cloud, or meets a failing one, is no
// verdict on the token: it throws, where "invalid" would have the creds dropped.
Deno.test("refresh: a 5xx or an unreachable Cloud throws an unavailable CloudApiError", async () => {
  const e503 = await assertRejects(
    () => new CloudClient(API, fakeFetch(503, {}).fn).refresh("RT"),
    CloudApiError,
  );
  assertEquals(e503.status, 503);
  const offline = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;
  const e0 = await assertRejects(() => new CloudClient(API, offline).refresh("RT"), CloudApiError);
  assertEquals(e0.status, 0);
  // Only fetch's network failure is mapped: any other error is not Cloud's.
  const bug = (() => Promise.reject(new RangeError("bug"))) as typeof fetch;
  await assertRejects(() => new CloudClient(API, bug).refresh("RT"), RangeError);
});

// cli#735 — an approving answer must carry a real pair, and cannot grant a token forever.
Deno.test('pollToken: approved without a real token pair is invalid, never the string "undefined"', async () => {
  const answers = [{ status: "approved" }, {
    status: "approved",
    access_token: "",
    refresh_token: "r",
  }];
  for (const json of answers) {
    assertEquals(await new CloudClient(API, fakeFetch(200, json).fn).pollToken("d"), {
      status: "invalid",
    });
  }
});

Deno.test("refresh and pollToken cap expires_in", async () => {
  const pair = { access_token: "a", refresh_token: "r", expires_in: 1e15 };
  const ok = await new CloudClient(API, fakeFetch(200, { status: "ok", ...pair }).fn).refresh("RT");
  assertEquals(ok.status === "ok" && ok.expiresInS, 31_536_000);
  const approved = await new CloudClient(API, fakeFetch(200, { status: "approved", ...pair }).fn)
    .pollToken("d");
  assertEquals(approved.status === "approved" && approved.expiresInS, 31_536_000);
});

Deno.test("pollToken: a status that is not a string approves nothing, however it stringifies", async () => {
  const body = { status: ["approved"], access_token: "a", refresh_token: "r" };
  assertEquals(await new CloudClient(API, fakeFetch(200, body).fn).pollToken("d"), {
    status: "invalid",
  });
});

Deno.test("a connection dropped mid-body rejects: an outage is not an empty listing", async () => {
  const dropped = new ReadableStream({ start: (c) => c.error(new TypeError("connection reset")) });
  const fn = (() => Promise.resolve(new Response(dropped, { status: 200 }))) as typeof fetch;
  const e = await assertRejects(() => new CloudClient(API, fn).listProjects("t"), CloudApiError);
  assertEquals([e.status, isUnavailable(e)], [0, true]);
});

Deno.test("refresh over a dropped body: no verdict, so nothing condemns the token", async () => {
  const dropped = new ReadableStream({ start: (c) => c.error(new TypeError("connection reset")) });
  const fn = (() => Promise.resolve(new Response(dropped, { status: 200 }))) as typeof fetch;
  const e = await assertRejects(() => new CloudClient(API, fn).refresh("RT"), CloudApiError);
  assertEquals([e.status, isUnavailable(e)], [0, true]);
});

Deno.test("no control character from a server survives a client method", async () => {
  const dirty = "a\x1b]0;x\x07b\x9bc";
  const clean = "a]0;xbc";
  const task = { number: 1, title: dirty, columnId: "c", priority: dirty, size: dirty };
  const body = {
    device_code: "d",
    user_code: dirty,
    verification_uri: dirty,
    projects: [{ key: dirty, name: dirty, role: dirty }],
    orgs: [{ slug: dirty, name: dirty, role: dirty }],
    columns: [{ id: "c", name: dirty, order: 1 }],
    tasks: [task],
    task,
    project: { key: dirty, name: dirty },
  };
  const c = new CloudClient(API, fakeFetch(200, body).fn, PATTERNS);
  const start = await c.startDevice();
  assertEquals([start.userCode, start.verificationUri, start.verificationUriComplete], [
    clean,
    clean,
    clean,
  ]);
  assertEquals(await c.listProjects("t"), [{ key: clean, name: clean, role: clean }]);
  assertEquals((await c.listOrgs("t"))[0].name, clean);
  assertEquals((await c.listColumns("t", "K"))[0].name, clean);
  const expected = { number: 1, title: clean, columnId: "c", priority: clean, size: clean };
  assertEquals(await c.listTasks("t", "K"), [expected]);
  assertEquals(await c.createTask("t", "K", "n"), expected);
  assertEquals((await c.createProject("t", "K", "n")).name, clean);
  const refused = new CloudClient(API, fakeFetch(400, { error: dirty }).fn);
  const e = await assertRejects(() => refused.listOrgs("t"), CloudApiError);
  assertEquals(e.message, clean);
});
