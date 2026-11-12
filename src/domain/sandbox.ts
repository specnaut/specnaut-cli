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
import {
  ALLOWED_SERVICES,
  DEVICES,
  SEATBELT_HIDDEN,
  SEATBELT_LISTINGS,
  SEATBELT_SYSCTLS,
  type Sysctls,
  SYSTEM,
  SYSTEM_PATH,
} from "./sandbox_hosts.ts";
import { LIMITS, type SandboxLimits } from "./sandbox_limits.ts";
import { ancestors, overlaps, pathProblem, within } from "./sandbox_paths.ts";

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
  /** Rootless podman can cap a run: cgroup v2, with pids, memory and cpu delegated to the user. */
  readonly podmanCgroups: boolean;
  /** A docker daemon answers. */
  readonly docker: boolean;
  /** Bubblewrap ran a trial command, or was stopped by the user-namespace restriction. */
  readonly bwrap: "usable" | "userns_restricted" | "absent";
  /** What `bwrap --version` printed, or `null` when it printed nothing. */
  readonly bwrapVersion: string | null;
  readonly sandboxExec: boolean;
};

const UNCAPPED_PODMAN =
  "container: rootless podman without cgroup v2 pids, memory and cpu delegated, and no docker";

/** The best backend `probe` offers; static only on Windows, where no backend is supported. */
export function chooseBackend(probe: BackendProbe): Backend {
  if (probe.os === "windows") return { kind: "static", why: ["no sandbox on Windows"] };
  const why: string[] = [];
  const podman = probe.podman === "rootless" && probe.podmanCgroups;
  const engine = podman ? "podman" : probe.docker ? "docker" : null;
  if (probe.image.kind === "none") why.push(`no container image: ${probe.image.why}`);
  else if (engine) return { kind: "container", engine, image: probe.image.ref };
  else {why.push(
      probe.podman === "rootless" ? UNCAPPED_PODMAN : "container: no rootless podman and no docker",
    );}
  if (probe.os === "linux") {
    const passedOver = bwrapWhy(probe);
    if (passedOver === null) return { kind: "bwrap" };
    why.push(passedOver);
  }
  if (probe.os === "darwin") {
    if (probe.sandboxExec) return { kind: "seatbelt" };
    why.push("sandbox-exec: not available");
  }
  return { kind: "static", why };
}

/** Why bubblewrap cannot run on this host, or `null` when it can. */
function bwrapWhy(probe: BackendProbe): string | null {
  if (probe.bwrap === "absent") return "bubblewrap: not installed";
  if (probe.bwrap === "userns_restricted") return "bubblewrap: user namespaces restricted";
  return forbidsNestedUserns(probe.bwrapVersion) ? null : OLD_BWRAP;
}

const OLD_BWRAP = "bubblewrap: older than 0.8, which cannot forbid nested user namespaces";

/** `--disable-userns` arrived in bubblewrap 0.8; an unreadable version counts as older. */
function forbidsNestedUserns(version: string | null): boolean {
  const found = version?.match(/(\d+)\.(\d+)/);
  return found ? Number(found[1]) > 0 || Number(found[2]) >= 8 : false;
}

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
  /**
   * Folders whose own entry may be stat'ed, on macOS: those above a visible folder, which
   * resolving its path walks through. A file's existence elsewhere stays hidden too.
   */
  readonly lookups: readonly string[];
  /** Folders whose names (not what lies beneath) may be listed, on macOS. */
  readonly listings: readonly string[];
  /** Folders never read, on macOS, even below an allowed one. */
  readonly hidden: readonly string[];
  /** Device files read and written (bubblewrap and a container provide their own `/dev`). */
  readonly devices: readonly string[];
  /** No network at all: loopback, unix sockets and dependency installs included. */
  readonly network: "none";
  readonly services: readonly string[];
  /** Kernel values readable on macOS; none elsewhere, where the launcher has no such filter. */
  readonly sysctls: Sysctls;
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
  const system = SYSTEM[backend];
  const reads = inContainer ? [paths.tree] : [...paths.toolchain, paths.tree];
  const writes = [home, tmp];
  const onMac = backend === "seatbelt";
  const policy: SandboxPolicy = {
    workdir: paths.tree,
    env: inContainer
      ? { HOME: home, TMPDIR: tmp }
      : { PATH: [...paths.path, ...SYSTEM_PATH].join(":"), HOME: home, TMPDIR: tmp },
    system,
    reads,
    writes,
    lookups: onMac ? ancestors([...system, ...reads, ...writes]) : [],
    listings: onMac ? SEATBELT_LISTINGS : [],
    hidden: onMac ? SEATBELT_HIDDEN : [],
    devices: DEVICES,
    network: "none",
    services: onMac ? ALLOWED_SERVICES : [],
    sysctls: onMac ? SEATBELT_SYSCTLS : { names: [], prefixes: [] },
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
