import { assertEquals, assertRejects } from "@std/assert";
import { CloudApiError, CloudClient } from "../../src/domain/cloud/cloud_client.ts";

const API = "https://dep.convex.site";

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
  const out = await new CloudClient(API, fn).createProject("AT", "new", "New");
  assertEquals(calls[0].method, "POST");
  assertEquals(calls[0].body, { key: "new", name: "New" });
  assertEquals(calls[0].auth, "Bearer AT");
  assertEquals(out.key, "NEW");
});

Deno.test("createProject surfaces a conflict as CloudApiError", async () => {
  const { fn } = fakeFetch(409, { error: "project key NEW already exists" });
  await assertRejects(
    () => new CloudClient(API, fn).createProject("AT", "NEW", "New"),
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
