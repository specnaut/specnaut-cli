// A stand-in for the Cloud API, run as its own process through cloud_stub.ts, by cloud_curl_test.ts and cloud_real_fetch_test.ts (the
// test suite itself holds no network permission). `/ok/…` answers; `/moved/…` sends a
// 307 to `/elsewhere/…`; `/status/<n>/…` answers n; `/partial/…` answers a body that
// is not the contract for a task or its children; `/dirty/…` and `/refused/…` answer
// strings that need normalizing, the second with `ok: false`; `/garbage/…` answers no
// JSON; `/created/<hex of a JSON value>/…` answers a task whose `createdAt` is that value and
// whose body holds a `created:` line; `/nocreated/…` answers a task without the field. Every
// request is one JSON line in `<dir>/requests.log`.

const dir = Deno.args[0];
const ANSWER = {
  ok: true,
  columns: [{ id: "c1", name: "Todo", order: 1 }, { id: "c2", name: "Done", order: 2 }],
  task: {
    key: "K-1",
    number: 1,
    title: "t",
    columnId: "c1",
    parentNumber: 2,
    createdAt: "2026-01-02T03:04:05.123Z",
  },
  tasks: [{ number: 2, title: "child", columnId: "c1" }],
  events: [],
  hasMore: false,
  cursor: "",
};

const CONTROL =
  "\x00\x07\x08\x0b\x1b]0;x\r\x1f\x7f\u0080\u009b\u009f\u200e\u200f\u202e\u2066\u2069";
const DIRTY = {
  ok: true,
  columns: ANSWER.columns.map((c) => ({ ...c, name: `${c.name}${CONTROL}` })),
  task: {
    ...ANSWER.task,
    key: `K-1${CONTROL}`,
    title: `t\nnext${CONTROL}`,
    body: `first\nsecond\tthird\u2028fourth${CONTROL}`,
    parentNumber: `2${CONTROL}`,
    createdAt: `2026-01-02T03:04:05Z\nnext${CONTROL}`,
  },
  tasks: [{
    number: 2,
    title: `child\nnext\u2028café 日本 👩‍💻${CONTROL}`,
    columnId: "c1",
  }],
  events: [
    { kind: "created", number: 1, toStage: `Todo\nnext${CONTROL}` },
    { kind: "moved", number: "7 x", fromStage: "old -> extra", toStage: "new -> more" },
  ],
  hasMore: false,
  cursor: "",
};
const REFUSED = { ok: false, error: `no${CONTROL}`, [`key${CONTROL}`]: 1 };

/** The answer of the `/created/` and `/nocreated/` routes; null for any other path. */
function createdAnswer(pathname: string): Response | null {
  const hex = pathname.match(/^\/created\/([^/]+)\//)?.[1];
  if (hex) {
    const bytes = Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
    const createdAt = JSON.parse(new TextDecoder().decode(bytes));
    const body = "created:\t2000-01-01T00:00:00Z";
    return Response.json({ ...ANSWER, task: { ...ANSWER.task, body, createdAt } });
  }
  if (pathname.startsWith("/nocreated/")) {
    const { createdAt: _, ...task } = ANSWER.task;
    return Response.json({ ...ANSWER, task });
  }
  return null;
}

const server = Deno.serve({
  hostname: "127.0.0.1",
  port: 0,
  onListen: ({ port }) => Deno.writeTextFileSync(`${dir}/port`, String(port)),
}, async (req) => {
  const url = new URL(req.url);
  const line = {
    path: url.pathname,
    authorization: req.headers.get("authorization"),
    extra: req.headers.get("x-from-user-config"),
    body: await req.text(),
  };
  await Deno.writeTextFile(`${dir}/requests.log`, JSON.stringify(line) + "\n", { append: true });
  if (url.pathname.startsWith("/moved/")) {
    const to = url.pathname.replace("/moved/", "/elsewhere/");
    return new Response("{}", { status: 307, headers: { Location: `${url.origin}${to}` } });
  }
  const status = url.pathname.match(/^\/status\/(\d+)\//)?.[1];
  if (status) return new Response(null, { status: Number(status) });
  if (url.pathname.startsWith("/partial/") && url.pathname.endsWith("/tasks")) {
    return Response.json({ ok: false });
  }
  if (url.pathname.startsWith("/garbage/")) {
    return new Response("<html>\x1b[31m", { status: 200 });
  }
  if (url.pathname.startsWith("/dirty/")) return Response.json(DIRTY);
  if (url.pathname.startsWith("/refused/")) return Response.json(REFUSED);
  return createdAnswer(url.pathname) ?? Response.json(ANSWER);
});

await server.finished;
