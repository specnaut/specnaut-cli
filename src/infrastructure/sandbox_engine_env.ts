/**
 * The environment a container engine's client starts with: what it needs to find and reach its
 * engine (its binaries, its home and runtime folders, its configuration, its connection), and
 * nothing else. An engine may be configured to copy its own environment into the container
 * (podman's `env_host`), so whatever the client is handed can end up beside the run's command:
 * the rest of ours never is. The run's own variables are the policy's, set by the arguments.
 * The probe asks the engine with these same variables, so the engine it finds is the one a run
 * reaches: the same storage, configuration and connection.
 */
const NAMES: ReadonlySet<string> = new Set([
  "PATH",
  "HOME",
  "XDG_RUNTIME_DIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "DBUS_SESSION_BUS_ADDRESS",
  "TMPDIR",
  "CONTAINERS_CONF",
  "CONTAINERS_CONF_OVERRIDE",
  "CONTAINERS_STORAGE_CONF",
  "CONTAINERS_REGISTRIES_CONF",
  "CONTAINER_HOST",
  "CONTAINER_CONNECTION",
  "CONTAINER_SSHKEY",
  "CONTAINER_PASSPHRASE",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
]);

/** The variables of `host` an engine's client is started with; one `host` does not set is left out. */
export function engineEnv(host: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(host).filter(([name]) => NAMES.has(name)),
  );
}
