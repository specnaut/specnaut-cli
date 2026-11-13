/**
 * What each backend's host offers a sandboxed gate: the system folders, devices and macOS services
 * a toolchain reads there. Data only: `sandboxPolicy` in `sandbox.ts` decides which of it a policy
 * carries, and is the one home of what a sandbox may touch.
 */

import type { ImageSource } from "./sandbox_image.ts";

/**
 * The limits a container engine can apply on its host, read the same way for both: docker's daemon
 * reports them (`docker info`), podman's come from its cgroup v2 controllers and a trial of the
 * user's own cgroup. One the host lacks is discarded from a run, whatever its arguments say.
 */
export type EngineLimits = {
  readonly memory: boolean;
  readonly swap: boolean;
  readonly pids: boolean;
  readonly cpuQuota: boolean;
};

/** What the host offers, as the caller probed it. */
export type BackendProbe = {
  /** `Deno.build.os`. */
  readonly os: string;
  /** `Deno.build.arch`: bubblewrap runs only where a syscall filter exists for it. */
  readonly arch: string;
  readonly image: ImageSource;
  /** Podman running as the user, as root (passed over), or not installed. */
  readonly podman: "rootless" | "root" | "absent";
  /**
   * Podman answers from a service it does not run itself (`host.serviceIsRemote`): a podman
   * machine's VM, `CONTAINER_HOST`, a containers.conf `[engine] remote`. That service starts a
   * container from its own containers.conf, never from the one the CLI hands a run's client.
   */
  readonly podmanRemote: boolean;
  /** What podman reported as its version (`version.Version`), or `null` when it did not. */
  readonly podmanVersion: string | null;
  /** What podman can limit for the user on cgroup v2; every one false off it or when absent. */
  readonly podmanLimits: EngineLimits;
  /** A docker daemon answers. */
  readonly docker: boolean;
  /**
   * That daemon is a podman service (`docker version` names a `Podman Engine` component), reached
   * by a docker client on its socket: it starts a container from its own containers.conf.
   */
  readonly dockerOnPodman: boolean;
  /** What that daemon can limit; every one false when none answers. */
  readonly dockerLimits: EngineLimits;
  /** Bubblewrap ran a trial command, was stopped by the user-namespace restriction, or failed. */
  readonly bwrap: "usable" | "userns_restricted" | "trial_failed" | "absent";
  /** What `bwrap --version` printed, or `null` when it printed nothing. */
  readonly bwrapVersion: string | null;
  /**
   * A systemd user scope can be made, with the pids, memory and cpu controllers delegated to it
   * (cgroup v2): bubblewrap then runs in one, which caps what it alone cannot.
   */
  readonly bwrapScope: boolean;
  readonly sandboxExec: boolean;
};

/**
 * Whether a bubblewrap of `version` (what `bwrap --version` printed) has `--disable-userns`,
 * which arrived in 0.8; an unreadable version counts as older.
 */
export function forbidsNestedUserns(version: string | null): boolean {
  const found = version?.match(/(\d+)\.(\d+)/);
  return found ? Number(found[1]) > 0 || Number(found[2]) >= 8 : false;
}

/**
 * macOS services a sandboxed process may never look up: each reads or acts on the user's
 * session (the keychain's secrets, opening apps, scripting them, the clipboard). Launchd job
 * submission is an operation, not a service: the profile denies `job-creation` instead.
 */
export const FORBIDDEN_SERVICES = {
  keychain: ["com.apple.SecurityServer", "com.apple.securityd"],
  launchServices: ["com.apple.coreservices.launchservicesd", "com.apple.lsd.mapdb"],
  appleEvents: ["com.apple.coreservices.appleevents"],
  pasteboard: ["com.apple.pasteboard.1"],
} as const;

/** The macOS services a gate may look up: user and group lookups (`id`, git's author). */
export const ALLOWED_SERVICES: readonly string[] = ["com.apple.system.opendirectoryd.libinfo"];

/** The files under `/etc` a Linux toolchain reads: the loader's cache, the zone, user lookups. */
const LINUX_ETC = ["alternatives", "ld.so.cache", "localtime", "passwd", "group", "nsswitch.conf"]
  .map((name) => `/etc/${name}`);

/** Read-only system folders per host; a listed folder the host lacks is skipped. */
export const SYSTEM = {
  bwrap: ["/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", ...LINUX_ETC],
  seatbelt: [
    "/usr/bin",
    "/usr/lib",
    "/usr/libexec",
    "/usr/sbin",
    "/usr/share",
    "/bin",
    "/sbin",
    "/System",
    "/Library/Developer/CommandLineTools",
    "/private/etc",
    "/private/var/db/timezone",
    "/private/var/select",
  ],
  container: [],
} as const;

export const SYSTEM_PATH = ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
export const DEVICES = ["/dev/null", "/dev/zero", "/dev/random", "/dev/urandom"];

/** On macOS the loader reads the root folder's own listing (its names, nothing beneath it). */
export const SEATBELT_LISTINGS: readonly string[] = ["/"];

/** Kernel values a sandboxed process may read on macOS, by exact name or by prefix. */
export type Sysctls = { readonly names: readonly string[]; readonly prefixes: readonly string[] };

/**
 * What a toolchain reads to size itself: CPU count, page size (Deno aborts without it), the
 * argument limit, the kernel release and the CPU's optional features. Nothing that names the
 * machine, its user or its other processes.
 */
export const SEATBELT_SYSCTLS: Sysctls = {
  names: ["hw.ncpu", "hw.pagesize_compat", "kern.argmax", "kern.osrelease"],
  prefixes: ["hw.optional."],
};

/**
 * Folders never read on macOS, even below an allowed one: `/System/Volumes/Data` is the data
 * volume, whose own entries `/System` would otherwise expose.
 */
export const SEATBELT_HIDDEN: readonly string[] = ["/System/Volumes/Data"];

/** What only `sandbox-exec` filters beyond folders, taken whole by a macOS policy. */
export const SEATBELT_RULES = {
  listings: SEATBELT_LISTINGS,
  hidden: SEATBELT_HIDDEN,
  services: ALLOWED_SERVICES,
  sysctls: SEATBELT_SYSCTLS,
} as const;

/** The same filters for a backend that has none of them: each list empty. */
export const NO_SEATBELT_RULES: typeof SEATBELT_RULES = {
  listings: [],
  hidden: [],
  services: [],
  sysctls: { names: [], prefixes: [] },
};
