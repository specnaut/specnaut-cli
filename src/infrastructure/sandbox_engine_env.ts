import { join } from "@std/path";
import type { Engine } from "../domain/sandbox.ts";

/**
 * The environment a container engine's client starts with: what it needs to find and reach its
 * engine (its binaries, its home and runtime folders, its configuration, its connection), and
 * nothing else. An engine may be configured to copy its own environment into the container
 * (podman's `env_host`), so whatever the client is handed can end up beside the run's command:
 * the rest of ours never is. The run's own variables are the policy's, set by the arguments.
 * The probe asks the engine with these same variables, so the engine it finds is the one a run
 * reaches: the same storage, configuration and connection.
 *
 * Names are matched as POSIX spells them, case and all. No container backend is offered on
 * Windows (`chooseBackend` answers static only there, and the probe asks no engine), so no engine
 * is ever started there with these, and Windows' `Path` or `SystemRoot` need no keeping.
 */
// CONTAINER_PASSPHRASE is left out: it is a secret, and serves only a remote connection, where
// `env_host` does not apply; an ssh agent or CONTAINER_SSHKEY alone serves that connection.
// CONTAINERS_CONF_OVERRIDE is left out: a podman run is handed the CLI's own (`engineRunEnv`).
const NAMES: ReadonlySet<string> = new Set([
  "PATH",
  "HOME",
  "XDG_RUNTIME_DIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "DBUS_SESSION_BUS_ADDRESS",
  "TMPDIR",
  "CONTAINERS_CONF",
  "CONTAINERS_STORAGE_CONF",
  "CONTAINERS_REGISTRIES_CONF",
  "CONTAINER_HOST",
  "CONTAINER_CONNECTION",
  "CONTAINER_SSHKEY",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
]);

/** The variables of `host` an engine's client starts with; one `host` does not set is left out. */
export function engineEnv(host: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(host).filter(([name]) => NAMES.has(name)),
  );
}

/**
 * The containers.conf a podman run's client loads after every other (`CONTAINERS_CONF_OVERRIDE`),
 * so the sandbox container starts from a CLI-owned configuration: nothing of the client's
 * environment copied in, and none of the variables, volumes, mounts or devices a containers.conf
 * adds to every container; its process, IPC, host-name and cgroup namespaces are its own. Every
 * other setting of the user's containers.conf (storage, runtime, connection) still applies, as it
 * does to the probe.
 *
 * Each list is written `[{append=false}]`: a plain `[]` is appended to, not set, where an earlier
 * file marked that list `{append=true}`, which stays in force for every file loaded after it. A
 * podman older than 4.8 cannot read that syntax, and is not offered (`sandbox_container.ts`).
 */
export const PODMAN_OVERRIDE = [
  "[containers]",
  "env_host = false",
  ...["env", "volumes", "mounts", "devices"].map((list) => `${list} = [{append=false}]`),
  'pidns = "private"',
  'ipcns = "private"',
  'utsns = "private"',
  'cgroupns = "private"',
  "",
].join("\n");

/** One run's engine environment, and how to remove what was written for it. */
export type RunEnv = { readonly env: Record<string, string>; readonly release: () => void };

/**
 * The environment one run's `engine` client starts with: `engineEnv` of `host`, and for podman
 * {@link PODMAN_OVERRIDE}, written for this run in a folder of its own. The user's own override is
 * replaced, not merged: podman loads one override file only, and a merge would rewrite a file
 * whose semantics are podman's. Docker reads no containers.conf and is handed nothing more.
 */
export async function engineRunEnv(
  engine: Engine,
  host: Readonly<Record<string, string>>,
): Promise<RunEnv> {
  const env = engineEnv(host);
  if (engine !== "podman") return { env, release: () => {} };
  const dir = await Deno.makeTempDir({ prefix: "specnaut-podman-" });
  const release = () => removeFolder(dir);
  try {
    const path = join(dir, "containers.conf");
    await Deno.writeTextFile(path, PODMAN_OVERRIDE, { mode: 0o600 });
    return { env: { ...env, CONTAINERS_CONF_OVERRIDE: path }, release };
  } catch (err) {
    release();
    throw err;
  }
}

/** Removes `dir`; one that cannot be removed is named, not raised: the run has already ended. */
function removeFolder(dir: string): void {
  try {
    Deno.removeSync(dir, { recursive: true });
  } catch (err) {
    console.error(`warning: ${dir} could not be removed: ${(err as Error).message}`);
  }
}
