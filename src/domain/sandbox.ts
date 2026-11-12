/**
 * Running a branch's gates in a sandbox: which isolation backend runs them, and what a sandboxed
 * process may touch. Both decisions live here and nowhere else; the argument and profile
 * generators (`sandbox_args.ts`, `sandbox_seatbelt.ts`) only translate a {@link SandboxPolicy}.
 *
 * The backends, best first: a container (rootless podman, then docker) running a digest-pinned
 * image; bubblewrap on Linux; `sandbox-exec` on macOS. With none of them the run is static only:
 * nothing executes and the tests are reported NOT RUN. A throwaway user account is not a backend:
 * creating one needs root, and it shares the host's network.
 *
 * Pure — no IO. The probe of what the host has, and the launch, are the caller's.
 */

import type { ImageSource } from "./sandbox_image.ts";
import { overlaps, pathProblem, within } from "./sandbox_paths.ts";

export type Engine = "podman" | "docker";
export type SandboxedBackend = "container" | "bwrap" | "seatbelt";

export type Backend =
  | { readonly kind: "container"; readonly engine: Engine; readonly image: string }
  | { readonly kind: "bwrap" }
  | { readonly kind: "seatbelt" }
  | { readonly kind: "static"; readonly why: readonly string[] };

/** What the host offers, as the caller probed it. */
export type BackendProbe = {
  /** `Deno.build.os`. */
  readonly os: string;
  readonly image: ImageSource;
  /** Podman running as the user, as root (passed over), or not installed. */
  readonly podman: "rootless" | "root" | "absent";
  /** A docker daemon answers. */
  readonly docker: boolean;
  /** Bubblewrap ran a trial command, or was stopped by the user-namespace restriction. */
  readonly bwrap: "usable" | "userns_restricted" | "absent";
  readonly sandboxExec: boolean;
};

/** The best backend `probe` offers; static only on Windows, where no backend is supported. */
export function chooseBackend(probe: BackendProbe): Backend {
  if (probe.os === "windows") return { kind: "static", why: ["no sandbox on Windows"] };
  const why: string[] = [];
  const engine = probe.podman === "rootless" ? "podman" : probe.docker ? "docker" : null;
  if (probe.image.kind === "none") why.push(`no container image: ${probe.image.why}`);
  else if (engine) return { kind: "container", engine, image: probe.image.ref };
  else why.push("container: no rootless podman and no docker");
  if (probe.os === "linux") {
    if (probe.bwrap === "usable") return { kind: "bwrap" };
    why.push(
      `bubblewrap: ${probe.bwrap === "absent" ? "not installed" : "user namespaces restricted"}`,
    );
  }
  if (probe.os === "darwin") {
    if (probe.sandboxExec) return { kind: "seatbelt" };
    why.push("sandbox-exec: not available");
  }
  return { kind: "static", why };
}

export type SandboxLimits = {
  readonly processes: number;
  readonly memoryBytes: number;
  readonly cpus: number;
  readonly wallClockSeconds: number;
  /** Per scratch folder. */
  readonly scratchBytes: number;
};

const GIB = 1024 ** 3;

/**
 * Enough for a test suite; a fork bomb, a memory bomb or a hang stops at them. A container's
 * arguments carry all but the wall clock, bubblewrap's the scratch cap; the launcher does the rest.
 */
export const LIMITS: SandboxLimits = {
  processes: 512,
  memoryBytes: 4 * GIB,
  cpus: 2,
  wallClockSeconds: 30 * 60,
  scratchBytes: GIB,
};

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
const SYSTEM = {
  bwrap: ["/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", ...LINUX_ETC],
  seatbelt: [
    "/usr",
    "/bin",
    "/sbin",
    "/System",
    "/Library/Developer/CommandLineTools",
    "/private/etc",
    "/private/var/db/timezone",
  ],
  container: [],
} as const;

const SYSTEM_PATH = ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
const DEVICES = ["/dev/null", "/dev/zero", "/dev/random", "/dev/urandom"];

/** The host's layout, as the caller resolved it: real paths, no link on the way. */
export type SandboxPaths = {
  /** The exported copy of the branch's tree: read-only, the working folder. */
  readonly tree: string;
  /** An empty private folder; the sandbox's home and temporary folders are made in it. */
  readonly scratch: string;
  /** Read-only folders holding the gates' tools; a container uses its image's instead. */
  readonly toolchain: readonly string[];
  /** Folders searched before the system's, each inside a folder that is read. */
  readonly path: readonly string[];
  /** The user's real home: neither it nor a folder holding it is ever visible. */
  readonly home: string;
  /** The user's checkout: no visible folder lies inside it or holds it. */
  readonly checkout: string;
};

/** What a sandboxed process may touch. Anything not named here is out of its reach. */
export type SandboxPolicy = {
  readonly workdir: string;
  /** Its whole environment; nothing is inherited from the host. */
  readonly env: Readonly<Record<string, string>>;
  readonly system: readonly string[];
  /** Read-only folders that must exist: the toolchain, then the tree. */
  readonly reads: readonly string[];
  /** The only writable folders, empty at the start and discarded after. */
  readonly writes: readonly string[];
  /** Device files read and written (bubblewrap and a container provide their own `/dev`). */
  readonly devices: readonly string[];
  /** No network at all: loopback, unix sockets and dependency installs included. */
  readonly network: "none";
  readonly services: readonly string[];
  /** The container's user: `nobody`, never the image's default, which is often root. */
  readonly user: string;
  readonly limits: SandboxLimits;
};

export type PolicyResult =
  | { readonly ok: true; readonly policy: SandboxPolicy }
  | { readonly ok: false; readonly why: string };

/** The policy for `backend` over `paths`, or why that layout cannot be sandboxed safely. */
export function sandboxPolicy(backend: SandboxedBackend, paths: SandboxPaths): PolicyResult {
  const inContainer = backend === "container";
  const home = `${paths.scratch}/home`;
  const tmp = `${paths.scratch}/tmp`;
  const policy: SandboxPolicy = {
    workdir: paths.tree,
    env: inContainer
      ? { HOME: home, TMPDIR: tmp }
      : { PATH: [...paths.path, ...SYSTEM_PATH].join(":"), HOME: home, TMPDIR: tmp },
    system: SYSTEM[backend],
    reads: inContainer ? [paths.tree] : [...paths.toolchain, paths.tree],
    writes: [home, tmp],
    devices: DEVICES,
    network: "none",
    services: backend === "seatbelt" ? ALLOWED_SERVICES : [],
    user: "65534:65534",
    limits: LIMITS,
  };
  const why = layoutProblem(paths, policy, inContainer ? [] : paths.path);
  return why === null ? { ok: true, policy } : { ok: false, why };
}

/** The first reason `policy` would expose the home, the checkout or a read-only folder. */
function layoutProblem(paths: SandboxPaths, policy: SandboxPolicy, path: readonly string[]) {
  const given = [paths.tree, paths.scratch, paths.home, paths.checkout, ...policy.reads, ...path];
  for (const p of given) {
    const problem = pathProblem(p);
    if (problem !== null) return `${JSON.stringify(p)} ${problem}`;
  }
  const readOnly = [...policy.system, ...policy.reads];
  for (const p of [...readOnly, paths.scratch]) {
    if (within(paths.home, p)) return `${p} is or holds the home folder`;
    if (overlaps(p, paths.checkout)) return `${p} overlaps the checkout`;
  }
  const shared = readOnly.find((p) => overlaps(p, paths.scratch));
  if (shared) return `the scratch folder overlaps ${shared}, which is only read`;
  const stray = path.find((p) => !readOnly.some((r) => within(p, r)));
  return stray ? `PATH entry ${stray} is in no folder the sandbox reads` : null;
}
