// A stand-in for the Cloud API, run as its own process by cloud_curl_test.ts (the
// test suite itself holds no network permission). `/ok/…` answers; `/moved/…` sends a
// 307 to `/elsewhere/…`; `/status/<n>/…` answers n; `/partial/…` answers a body that
// is not the contract for a task or its children. Every request is one JSON line in
// `<dir>/requests.log`.

const dir = Deno.args[0];
const ANSWER = {
  ok: true,
  columns: [{ id: "c1", name: "Todo", order: 1 }, { id: "c2", name: "Done", order: 2 }],
  task: { key: "K-1", number: 1, title: "t", columnId: "c1", parentNumber: 2 },
  tasks: [{ number: 2, title: "child", columnId: "c1" }],
  events: [],
  hasMore: false,
  cursor: "",
};

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
  return Response.json(ANSWER);
});

await server.finished;
