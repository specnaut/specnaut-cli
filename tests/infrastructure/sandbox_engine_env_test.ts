import { assertEquals } from "@std/assert";
import { engineEnv } from "../../src/infrastructure/sandbox_engine_env.ts";

/**
 * The container engine's client starts with the variables it needs to reach its engine and
 * nothing else: an engine configured to copy its own environment into the container then copies
 * only these.
 */

const NEEDED = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/dev",
  XDG_RUNTIME_DIR: "/run/user/1000",
  DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
  TMPDIR: "/tmp",
  CONTAINERS_CONF: "/etc/containers/containers.conf",
  CONTAINERS_CONF_OVERRIDE: "/home/dev/override.conf",
  CONTAINERS_STORAGE_CONF: "/home/dev/storage.conf",
  CONTAINERS_REGISTRIES_CONF: "/home/dev/registries.conf",
  XDG_CONFIG_HOME: "/home/dev/.config",
  XDG_DATA_HOME: "/home/dev/.local/share",
  CONTAINER_SSHKEY: "/home/dev/.ssh/podman",
  CONTAINER_HOST: "unix:///run/podman.sock",
  CONTAINER_CONNECTION: "dev",
  DOCKER_HOST: "unix:///var/run/docker.sock",
  DOCKER_CONTEXT: "default",
  DOCKER_CONFIG: "/home/dev/.docker",
  DOCKER_CERT_PATH: "/home/dev/.docker/certs",
  DOCKER_TLS_VERIFY: "1",
};

const OTHERS = {
  GITHUB_TOKEN: "ghp_example",
  GITLAB_TOKEN: "glpat-example",
  AWS_SECRET_ACCESS_KEY: "example",
  HTTP_PROXY: "http://proxy.example:3128",
  USER: "dev",
  DOCKER_HOSTNAME: "not-a-docker-variable",
  XCONTAINERS_CONF: "not-a-prefix-match",
  CONTAINERS_CONF_EXTRA: "not-a-name-the-engine-reads",
  // A secret: a local podman with env_host would copy it into the container.
  CONTAINER_PASSPHRASE: "example",
};

Deno.test("engineEnv: keeps exactly the variables the engine needs, dropping every other", () => {
  assertEquals(engineEnv({ ...OTHERS, ...NEEDED }), NEEDED);
});

Deno.test("engineEnv: a needed variable the host does not set is left out, never made up", () => {
  assertEquals(engineEnv({ PATH: "/bin", GITHUB_TOKEN: "x" }), { PATH: "/bin" });
  assertEquals(engineEnv({}), {});
});
