import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const SERVER = fromFileUrl(new URL("./cloud_stub_server.ts", import.meta.url));

export type StubRequest = { path: string; authorization: string | null; extra: string | null };

/** A file's text, or "" when it does not exist yet. Any other failure is a failure. */
async function readIfThere(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return "";
    throw e;
  }
}

/** The stub server, for the length of `fn`. */
export async function withServer(
  fn: (port: string, requests: () => Promise<StubRequest[]>) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: "cloud-stub-" });
  const child = new Deno.Command("deno", {
    args: ["run", "--no-config", "--allow-net=127.0.0.1", `--allow-write=${dir}`, SERVER, dir],
    stdout: "null",
    stderr: "null",
  }).spawn();
  try {
    let port = "";
    for (let i = 0; i < 300 && !port; i++) {
      port = await readIfThere(join(dir, "port"));
      if (!port) await new Promise((r) => setTimeout(r, 100));
    }
    assertEquals(port !== "", true, "the stub server did not start");
    await fn(port, async () => {
      const log = await readIfThere(join(dir, "requests.log"));
      return log.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    });
  } finally {
    child.kill();
    await child.status;
    await Deno.remove(dir, { recursive: true });
  }
}
