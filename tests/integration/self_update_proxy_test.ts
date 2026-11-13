import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { PERMISSIONS } from "../../scripts/build.ts";
// Only for the type check: the server is spawned, so `deno test` would not reach it otherwise.
import type * as _Server from "./deny_proxy_server.ts";

/**
 * `specnaut self-update --check` behind a proxy that denies everything (cli#795, from the
 * retired parity scenario `net-deny`). The proxy is this test's own listener and counts what
 * reaches it, so a failed command is not enough: the request has to have gone through the
 * configured proxy, for api.github.com and nothing else, and been refused there. A command that
 * failed without asking would pass a test that only read the exit code.
 */

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));
const SERVER = fromFileUrl(new URL("./deny_proxy_server.ts", import.meta.url));

type Hit = { method: string; host: string };

async function readIfThere(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return "";
    throw e;
  }
}

/** The port the proxy server wrote to `dir`, once it is listening. */
async function waitForPort(dir: string): Promise<string> {
  for (let i = 0; i < 300; i++) {
    const port = await readIfThere(join(dir, "port"));
    if (port) return port;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the deny proxy did not start");
}

/** The deny proxy, for the length of `fn`: its URL, and the requests it has refused so far. */
async function withDenyProxy(fn: (url: string, hits: () => Promise<Hit[]>) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-deny-proxy-" });
  const child = new Deno.Command("deno", {
    args: ["run", "--no-config", "--allow-net=127.0.0.1", `--allow-write=${dir}`, SERVER, dir],
    stdout: "null",
    stderr: "inherit",
  }).spawn();
  try {
    const port = await waitForPort(dir);
    await fn(`http://127.0.0.1:${port}`, async () => {
      const log = await readIfThere(join(dir, "hits.log"));
      return log.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    });
  } finally {
    child.kill();
    await child.status;
    await Deno.remove(dir, { recursive: true });
  }
}

/** Every proxy variable, both spellings, at `url`, and no host exempt from it. */
function proxiedEnv(url: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]) {
    env[name] = env[name.toLowerCase()] = url;
  }
  env.NO_PROXY = env.no_proxy = "";
  // Deno's own release check would be a second host at the proxy.
  env.DENO_NO_UPDATE_CHECK = "1";
  return env;
}

/**
 * `self-update --check` behind the proxy at `url`, with the binary's own permissions, net
 * included. The module cache is filled first, outside the proxy, so that the run itself can be
 * `--cached-only`: a module download is never what reaches the proxy, even on a fresh CI runner.
 */
async function checkBehind(url: string): Promise<{ code: number; out: string; err: string }> {
  const cached = await new Deno.Command("deno", { args: ["cache", MAIN], stdout: "null" }).output();
  assertEquals(cached.code, 0, new TextDecoder().decode(cached.stderr));
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--cached-only", ...PERMISSIONS, MAIN, "self-update", "--check"],
    env: proxiedEnv(url),
    stdout: "piped",
    stderr: "piped",
  }).output();
  const [out, err] = [stdout, stderr].map((b) => new TextDecoder().decode(b));
  return { code, out, err };
}

Deno.test("self-update --check asks api.github.com through the configured proxy and fails when refused", async () => {
  await withDenyProxy(async (url, hits) => {
    const { code, out, err } = await checkBehind(url);
    assertNotEquals(code, 0, out);
    assertStringIncludes(err, "error:");
    const seen = await hits();
    assert(seen.length > 0, `the proxy saw no request; the command said: ${err}`);
    assertEquals(seen.map((h) => h.host).filter((h) => h !== "api.github.com"), [], err);
    assertEquals(/update available|up to date/.test(out), false, out);
  });
});
