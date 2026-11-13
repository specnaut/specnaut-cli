/**
 * A proxy that denies every request and counts it, spawned by `self_update_proxy_test.ts`: started as
 * `deny_proxy_server.ts <dir>`, it writes its port to `<dir>/port`, then, per request, one JSON
 * line `{ method, host }` to `<dir>/hits.log` and a `403`. Raw TCP rather than `Deno.serve`, so
 * a `CONNECT` — how a client asks a proxy for an https host — reaches it like any request.
 */

const dir = Deno.args[0];
const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
await Deno.writeTextFile(`${dir}/port`, String(listener.addr.port));

/** The host a request is for: a `CONNECT host:port` target, an absolute URL, or its Host header. */
function hostOf(target: string, head: string): string {
  if (/^[^/]+:\d+$/.test(target)) return target.replace(/:\d+$/, "");
  if (URL.canParse(target)) return new URL(target).hostname;
  return /^host:\s*([^:\r\n]+)/im.exec(head)?.[1] ?? "";
}

/** The request head, up to the blank line, at most 64 KiB. */
async function headOf(conn: Deno.Conn): Promise<string> {
  const buf = new Uint8Array(65536);
  let read = 0;
  let text = "";
  while (read < buf.length && !text.includes("\r\n\r\n")) {
    const n = await conn.read(buf.subarray(read));
    if (n === null) break;
    read += n;
    text = new TextDecoder().decode(buf.subarray(0, read));
  }
  return text;
}

async function deny(conn: Deno.Conn): Promise<void> {
  try {
    const head = await headOf(conn);
    const [method = "", target = ""] = head.split("\r\n", 1)[0].split(" ");
    const host = hostOf(target, head);
    await Deno.writeTextFile(`${dir}/hits.log`, JSON.stringify({ method, host }) + "\n", {
      append: true,
    });
    const body = `specnaut test: network denied: ${host}`;
    await conn.write(new TextEncoder().encode(
      `HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\n` +
        `Connection: close\r\n\r\n${body}`,
    ));
  } catch (err) {
    console.error(`deny proxy: ${err}`);
  } finally {
    conn.close();
  }
}

for await (const conn of listener) deny(conn);
