import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { OfferedBackend } from "../../src/domain/sandbox.ts";
import type { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { runnerFor } from "../../src/infrastructure/sandbox_runners.ts";
import { PROXY_NAMES } from "../domain/sandbox_fixture.ts";
import {
  live,
  type Run,
  runIn,
  RUNNER_HOST,
  skipOf,
  STATUSES,
  withEnv,
  withLayout,
} from "./sandbox_live_fixture.ts";

/**
 * The host's proxy settings never reach a run, on each backend this host offers. They are set
 * where each engine would copy them from: our environment (podman) and the client's
 * configuration file (docker), the latter in a folder of the test's own. Inside, a container
 * sees every proxy variable set and empty; bubblewrap and `sandbox-exec`, which start from an
 * empty environment, see none. A backend this host does not offer is skipped, saying why.
 */

const PROXY = "http://proxy.example:3128";
const CONFIG_KEYS = ["httpProxy", "httpsProxy", "ftpProxy", "noProxy", "allProxy"];

/**
 * Docker's client configuration in a folder of its own, holding proxies, with the daemon it
 * would otherwise find through the user's configuration named in DOCKER_HOST.
 */
async function dockerProxies(folder: string): Promise<Record<string, string>> {
  const proxies = Object.fromEntries(CONFIG_KEYS.map((k) => [k, PROXY]));
  await Deno.writeTextFile(
    join(folder, "config.json"),
    JSON.stringify({ proxies: { default: proxies } }),
  );
  const args = ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"];
  const host = new TextDecoder().decode(new Deno.Command("docker", { args }).outputSync().stdout);
  return { DOCKER_CONFIG: folder, DOCKER_HOST: Deno.env.get("DOCKER_HOST") ?? host.trim() };
}

/** Every proxy variable set on the host, and docker's client configured with proxies. */
async function hostProxies(offered: OfferedBackend, folder: string) {
  const docker = offered.kind === "container" && offered.engine === "docker";
  const vars = Object.fromEntries(PROXY_NAMES.map((name) => [name, PROXY]));
  return { ...vars, ...(docker ? await dockerProxies(folder) : {}) };
}

/** The proxy variables a run on `offered` sees, with the host's proxy settings in place. */
async function proxiesInside(offered: OfferedBackend, { policy, scratch }: Run): Promise<string[]> {
  let seen: string[] = [];
  await withEnv(await hostProxies(offered, scratch), async () => {
    const make = (l: DenoProcessLauncher) => runnerFor(offered, l, RUNNER_HOST);
    const { out } = await runIn(make, policy, ["/bin/sh", "-c", "echo start; env"]);
    // Only the run's own shell prints it: a run that never started proves nothing.
    assert(out.startsWith("start\n"), `the run never started: ${out.slice(0, 200)}`);
    seen = out.split("\n").filter((l) => PROXY_NAMES.includes(l.split("=")[0]));
  });
  return seen.sort();
}

for (const status of STATUSES) {
  const missing = skipOf(status);
  const offered = "offered" in status ? status.offered : null;
  const blank = status.kind === "container" ? PROXY_NAMES.map((n) => `${n}=`) : [];
  Deno.test({
    name: live(
      `env live: on ${status.kind}, the host's proxy settings never reach the run`,
      missing,
    ),
    ignore: missing !== null,
    fn: () =>
      withLayout(status.kind, async (run) => {
        assertEquals(await proxiesInside(offered!, run), blank.sort());
      }),
  });
}
