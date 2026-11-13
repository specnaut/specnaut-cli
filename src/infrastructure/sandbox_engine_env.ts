/**
 * The environment a container engine's client starts with: what it needs to find and reach its
 * engine (its binaries, its home and runtime folders, its configuration, its connection), and
 * nothing else. An engine may be configured to copy its own environment into the container
 * (podman's `env_host`), so whatever the client is handed can end up beside the run's command:
 * the rest of ours never is. The run's own variables are the policy's, set by the arguments.
 */
const NAMES: ReadonlySet<string> = new Set([
  "PATH",
  "HOME",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "TMPDIR",
  "CONTAINER_HOST",
  "CONTAINER_CONNECTION",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
]);

/** Podman's configuration variables: `CONTAINERS_CONF` and the ones it names as a prefix. */
const CONF_PREFIX = "CONTAINERS_CONF";

/** The variables of `host` an engine's client is started with; one `host` does not set is left out. */
export function engineEnv(host: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(host).filter(([name]) => NAMES.has(name) || name.startsWith(CONF_PREFIX)),
  );
}
