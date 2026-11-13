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

/** The empty folder a run's podman reads OCI hooks from, in the run's own folder. */
export const HOOKS = "hooks";
/** The empty mounts.conf a run's podman reads, in the run's own folder. */
export const MOUNTS = "mounts.conf";

/**
 * The containers.conf a podman run's client loads after every other (`CONTAINERS_CONF_OVERRIDE`),
 * written for one run in `dir`, so the sandbox container starts from a CLI-owned configuration:
 * nothing of the client's environment copied in, and none of the variables, volumes, mounts,
 * devices or annotations a containers.conf adds to every container; its process, IPC, host-name
 * and cgroup namespaces are its own. Every other setting of the user's containers.conf (storage,
 * runtime, connection) still applies, as it does to the probe.
 *
 * Each list is written `[{append=false}]`: a plain `[]` is appended to, not set, where an earlier
 * file marked that list `{append=true}`, which stays in force for every file loaded after it. A
 * podman older than 4.8 cannot read that syntax, and is not offered (`sandbox_container.ts`).
 * `[engine] hooks_dir` names {@link HOOKS}, an empty folder in `dir`, so no OCI hook runs around
 * the container. Annotations are emptied too: one can change how the runtime starts it (crun's
 * `run.oci.*`). Mounts.conf, the other file that adds to every container, is no containers.conf
 * setting: {@link podmanGlobals} handles it.
 *
 * Left to the user's configuration, on purpose: `seccomp_profile`, whose default is a path the
 * distribution chooses (or podman's built-in profile, where that file is missing), so the CLI
 * cannot name it on every host; the run's own arguments drop every capability, forbid privilege
 * gain and run as `nobody`, which no containers.conf takes back. `label` (and `apparmor_profile`):
 * labelling is podman's default wherever SELinux is enabled; forcing it on would make the tree's
 * read-only bind mount unreadable on a host whose user turned it off to let that mount through,
 * and relabelling the mount (`:z`) would rewrite the labels of the user's own files.
 */
export function podmanOverride(dir: string): string {
  const reset = "[{append=false}]";
  return [
    "[containers]",
    "env_host = false",
    ...["env", "volumes", "mounts", "devices", "annotations"].map((list) => `${list} = ${reset}`),
    'pidns = "private"',
    'ipcns = "private"',
    'utsns = "private"',
    'cgroupns = "private"',
    "",
    "[engine]",
    `hooks_dir = [${JSON.stringify(join(dir, HOOKS))}, {append=false}]`,
    "",
  ].join("\n");
}

/**
 * The options a run's podman takes before `run`, for what no containers.conf can set: the
 * mounts.conf it reads is {@link MOUNTS}, empty, so none of the user's or the system's
 * (`~/.config/containers/mounts.conf`, `/etc/containers/mounts.conf`,
 * `/usr/share/containers/mounts.conf`) adds a folder to the container. `--default-mounts-file`
 * is a hidden option of podman's, and the only way to name that file.
 */
export function podmanGlobals(dir: string): string[] {
  return ["--default-mounts-file", join(dir, MOUNTS)];
}

/**
 * One run's engine environment, the options its engine takes before `run`, and how to remove what
 * was written for it.
 */
export type RunEnv = {
  readonly env: Record<string, string>;
  readonly globals: readonly string[];
  readonly release: () => void;
};

/**
 * The environment one run's `engine` client starts with: `engineEnv` of `host`, and for podman
 * {@link podmanOverride}, written for this run in a folder of its own beside the empty hooks folder
 * and mounts.conf it names, with {@link podmanGlobals}. The user's own override is replaced, not
 * merged: podman loads one override file only, and a merge would rewrite a file whose semantics
 * are podman's. Docker reads no containers.conf and is handed nothing more.
 */
export async function engineRunEnv(
  engine: Engine,
  host: Readonly<Record<string, string>>,
): Promise<RunEnv> {
  const env = engineEnv(host);
  if (engine !== "podman") return { env, globals: [], release: () => {} };
  const dir = await Deno.makeTempDir({ prefix: "specnaut-podman-" });
  const release = () => removeFolder(dir);
  try {
    const path = join(dir, "containers.conf");
    await Deno.mkdir(join(dir, HOOKS), { mode: 0o700 });
    await Deno.writeTextFile(join(dir, MOUNTS), "", { mode: 0o600 });
    await Deno.writeTextFile(path, podmanOverride(dir), { mode: 0o600 });
    const globals = podmanGlobals(dir);
    return { env: { ...env, CONTAINERS_CONF_OVERRIDE: path }, globals, release };
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
