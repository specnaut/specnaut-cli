/**
 * Running a branch's gates in a sandbox: which isolation backend runs them, and what a sandboxed
 * process may touch. Both decisions live here and nowhere else; the argument and profile
 * generators (`sandbox_args.ts`, `sandbox_bwrap_args.ts`, `sandbox_seatbelt.ts`) only translate a
 * {@link SandboxPolicy}.
 *
 * The backends, best first: a container (rootless podman, then docker) running a digest-pinned
 * image; bubblewrap on Linux; `sandbox-exec` on macOS. With none of them the run is static only:
 * nothing executes and the tests are reported NOT RUN. A throwaway user account is not a backend:
 * creating one needs root, and it shares the host's network.
 *
 * Pure — no IO. The probe of what the host has, and the launch, are the caller's.
 */

import {
  type BackendProbe,
  DEVICES,
  forbidsNestedUserns,
  NO_SEATBELT_RULES,
  SEATBELT_RULES,
  type Sysctls,
  SYSTEM,
  SYSTEM_PATH,
} from "./sandbox_hosts.ts";
import { containerStatus } from "./sandbox_container.ts";
import { LIMITS, type ReportedCap, type SandboxLimits } from "./sandbox_limits.ts";
import { isFilterArch } from "./sandbox_seccomp.ts";
import { ancestors, layoutProblem, type SandboxPaths } from "./sandbox_paths.ts";

export type { BackendProbe };

export type Engine = "podman" | "docker";

export type Backend =
  | {
    readonly kind: "container";
    readonly engine: Engine;
    readonly image: string;
    /** The caps its engine drops on this host: the run goes without them, and says so. */
    readonly dropped: readonly ReportedCap[];
    /** The CPUs on its engine's host, or `null` where the engine did not say (`containerArgs`). */
    readonly cpus: number | null;
  }
  /** `scope`: run inside a systemd user scope that caps memory, processes and CPU. */
  | { readonly kind: "bwrap"; readonly scope: boolean }
  | { readonly kind: "seatbelt" }
  | { readonly kind: "static"; readonly why: readonly string[] };

/** A backend that runs something: every one but static only. */
export type SandboxedBackend = Exclude<Backend["kind"], "static">;

/** A backend that runs something, as chosen: its kind with what it runs with. */
export type OfferedBackend = Exclude<Backend, { readonly kind: "static" }>;

/** One backend as a probe finds it: what it offers here, or why not, and if it is this OS's. */
export type BackendStatus =
  | { readonly kind: SandboxedBackend; readonly offered: OfferedBackend }
  | { readonly kind: SandboxedBackend; readonly why: string; readonly onThisOs: boolean };

const WINDOWS = "no sandbox on Windows";

/** The best backend `probe` offers: the first {@link assessBackends} offers, else static only. */
export function chooseBackend(probe: BackendProbe): Backend {
  if (probe.os === "windows") return { kind: "static", why: [WINDOWS] };
  const why: string[] = [];
  for (const status of assessBackends(probe)) {
    if ("offered" in status) return status.offered;
    if (status.onThisOs) why.push(status.why);
  }
  return { kind: "static", why };
}

/** Every backend in selection order: a container, bubblewrap, then `sandbox-exec`. */
export function assessBackends(probe: BackendProbe): BackendStatus[] {
  const { os } = probe;
  if (os === "windows") return KINDS.map((kind) => ({ kind, why: WINDOWS, onThisOs: false }));
  const bwrap = os === "linux" ? bwrapWhy(probe) : "bubblewrap: Linux only";
  const mac = os !== "darwin" ? "sandbox-exec: macOS only" : "sandbox-exec: not available";
  const seatbelt = os === "darwin" && probe.sandboxExec ? null : mac;
  return [
    containerStatus(probe),
    bwrap === null
      ? { kind: "bwrap", offered: { kind: "bwrap", scope: probe.bwrapScope } }
      : { kind: "bwrap", why: bwrap, onThisOs: os === "linux" },
    seatbelt === null
      ? OFFERED.seatbelt
      : { kind: "seatbelt", why: seatbelt, onThisOs: os === "darwin" },
  ];
}

const KINDS: readonly SandboxedBackend[] = ["container", "bwrap", "seatbelt"];
const OFFERED = { seatbelt: { kind: "seatbelt", offered: { kind: "seatbelt" } } } as const;

/** Why bubblewrap cannot run on this Linux host, or `null` when it can. */
function bwrapWhy(probe: BackendProbe): string | null {
  if (probe.bwrap === "absent") return "bubblewrap: not installed";
  if (probe.bwrap === "userns_restricted") return "bubblewrap: user namespaces restricted";
  if (probe.bwrap === "trial_failed") return "bubblewrap: a trial run failed";
  if (!forbidsNestedUserns(probe.bwrapVersion)) return OLD_BWRAP;
  return isFilterArch(probe.arch) ? null : `bubblewrap: no syscall filter for ${probe.arch}`;
}

const OLD_BWRAP = "bubblewrap: older than 0.8, which cannot forbid nested user namespaces";

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
  const onMac = backend === "seatbelt";
  const visible = folders(backend, paths);
  const policy: SandboxPolicy = {
    workdir: paths.tree,
    env: environment(inContainer, paths.path, visible.writes),
    ...visible,
    ...(onMac ? SEATBELT_RULES : NO_SEATBELT_RULES),
    lookups: onMac ? ancestors([...visible.system, ...visible.reads, ...visible.writes]) : [],
    devices: DEVICES,
    network: "none",
    user: "65534:65534",
    limits: LIMITS,
  };
  const readOnly = [...policy.system, ...policy.reads];
  const why = layoutProblem(paths, readOnly, inContainer ? [] : paths.path);
  return why === null ? { ok: true, policy } : { ok: false, why };
}

type Folders = Pick<SandboxPolicy, "system" | "reads" | "writes">;

/** The system folders, the read-only toolchain and tree, and the scratch home and temp. */
function folders(backend: SandboxedBackend, paths: SandboxPaths): Folders {
  const inContainer = backend === "container";
  return {
    system: SYSTEM[backend],
    reads: inContainer ? [paths.tree] : [...paths.toolchain, paths.tree],
    writes: [`${paths.scratch}/home`, `${paths.scratch}/tmp`],
  };
}

/** The whole environment: a container keeps its pinned image's PATH, a host gets a fixed one. */
function environment(
  inContainer: boolean,
  path: readonly string[],
  writes: readonly string[],
): Record<string, string> {
  const [home, tmp] = writes;
  if (inContainer) return { HOME: home, TMPDIR: tmp };
  return { PATH: [...path, ...SYSTEM_PATH].join(":"), HOME: home, TMPDIR: tmp };
}
