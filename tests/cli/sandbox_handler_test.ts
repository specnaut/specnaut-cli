import { assertEquals } from "@std/assert";
import { runSandbox, type SandboxDeps } from "../../src/cli/handlers/sandbox_handler.ts";
import type { ExecOutcome } from "../../src/application/sandbox_exec.ts";
import { SandboxRefused } from "../../src/application/sandbox_ports.ts";
import type { BackendProbe, SandboxedBackend } from "../../src/domain/sandbox.ts";
import {
  CAP_ENFORCEMENT,
  CAP_NAMES,
  type SandboxLimits,
  STOP_LIMIT,
} from "../../src/domain/sandbox_limits.ts";
import type { SandboxIntent } from "../../src/cli/intent.ts";

/**
 * `specnaut sandbox`'s output and exit codes: `probe` lists every backend, then the one chosen;
 * `exec` exits with the command's code, 124 when the wall clock ran out, 125 when nothing ran.
 */

const SHA = "a".repeat(40);
const MAC: BackendProbe = {
  os: "darwin",
  arch: "aarch64",
  image: { kind: "none", why: "no devcontainer" },
  podman: "absent",
  podmanCgroups: false,
  docker: false,
  bwrap: "absent",
  bwrapVersion: null,
  bwrapScope: false,
  sandboxExec: true,
};

function deps(probe: BackendProbe, exec: () => Promise<ExecOutcome>) {
  const out: string[] = [];
  const err: string[] = [];
  const d: SandboxDeps = {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    probe: () => Promise.resolve(probe),
    exec: () => exec(),
  };
  return { d, out, err };
}

const EXEC: SandboxIntent = {
  kind: "sandbox",
  sub: "exec",
  sha: SHA,
  toolchain: [],
  command: ["make"],
};
const PROBE: SandboxIntent = { kind: "sandbox", sub: "probe" };

Deno.test("sandbox probe: each backend, available or why not, then the one a run would use", async () => {
  const { d, out } = deps(MAC, () => Promise.reject(new Error("unused")));
  assertEquals(await runSandbox(PROBE, d), 0);
  assertEquals(
    out.join("\n"),
    [
      "UNAVAILABLE container no container image: no devcontainer",
      "UNAVAILABLE bwrap bubblewrap: Linux only",
      "AVAILABLE seatbelt",
      ...uncapped("seatbelt"),
      `LIMIT seatbelt ${STOP_LIMIT.seatbelt}`,
      "BACKEND seatbelt",
    ].join("\n"),
  );
});

Deno.test("sandbox probe: with no backend it says static and exits 1", async () => {
  const { d, out } = deps(
    { ...MAC, sandboxExec: false },
    () => Promise.reject(new Error("unused")),
  );
  assertEquals(await runSandbox(PROBE, d), 1);
  assertEquals(out.join("\n").split("\n").at(-1), "BACKEND static");
});

Deno.test("sandbox exec: the command's exit code is the exit code", async () => {
  const ran: ExecOutcome = {
    kind: "ran",
    backend: "container",
    outcome: { kind: "exited", code: 42 },
    unenforced: [],
  };
  const { d, err } = deps(MAC, () => Promise.resolve(ran));
  assertEquals(await runSandbox(EXEC, d), 42);
  assertEquals(err, []);
});

Deno.test("sandbox exec: the wall clock running out is 124, and said", async () => {
  const late: ExecOutcome = {
    kind: "ran",
    backend: "seatbelt",
    outcome: { kind: "timed_out", seconds: 1800 },
    unenforced: [],
  };
  const { d, err } = deps(MAC, () => Promise.resolve(late));
  assertEquals(await runSandbox(EXEC, d), 124);
  assertEquals(err.join("\n").includes("the wall clock ran out after 1800 s"), true);
});

Deno.test("sandbox exec: nothing ran is 125, with the reason", async () => {
  const notRun: ExecOutcome = { kind: "not_run", why: "no backend: no sandbox on Windows" };
  const { d, err } = deps(MAC, () => Promise.resolve(notRun));
  assertEquals(await runSandbox(EXEC, d), 125);
  assertEquals(err.join("\n").includes("not run: no backend: no sandbox on Windows"), true);
});

Deno.test("sandbox exec: a refusal or a launcher that cannot start is 125, never a crash", async () => {
  for (const failure of [new SandboxRefused("no export of it"), new Error("bwrap: not found")]) {
    const { d, err } = deps(MAC, () => Promise.reject(failure));
    assertEquals(await runSandbox(EXEC, d), 125);
    assertEquals(err.join("\n").includes(failure.message), true);
  }
});

/**
 * The caps the table says `backend` runs without, read from the table itself: those it enforces
 * nowhere, and those only a user scope enforces when it runs without one.
 */
function capsWithout(backend: SandboxedBackend, scope = false): (keyof SandboxLimits)[] {
  const by = CAP_ENFORCEMENT[backend];
  return (Object.keys(by) as (keyof SandboxLimits)[])
    .filter((cap) => by[cap] === "unenforced" || (by[cap] === "scope" && !scope));
}

/** The UNCAPPED line the table calls for, if any. */
function uncapped(backend: SandboxedBackend, scope = false): string[] {
  const caps = capsWithout(backend, scope);
  return caps.length === 0
    ? []
    : [`UNCAPPED ${backend} ${caps.map((c) => CAP_NAMES[c]).join(",")}`];
}

const ran = (backend: SandboxedBackend): Extract<ExecOutcome, { kind: "ran" }> => ({
  kind: "ran",
  backend,
  outcome: { kind: "exited", code: 0 },
  unenforced: capsWithout(backend),
});

Deno.test("sandbox exec: a run says on stderr the caps it went without and what its stop missed", async () => {
  for (const backend of ["container", "bwrap", "seatbelt"] as const) {
    const { d, out, err } = deps(MAC, () => Promise.resolve(ran(backend)));
    assertEquals(await runSandbox(EXEC, d), 0);
    const limit = STOP_LIMIT[backend];
    const lines = [...uncapped(backend), ...(limit === null ? [] : [`LIMIT ${backend} ${limit}`])];
    assertEquals(err, lines.map((l) => `notice: specnaut sandbox exec: ${l}`), backend);
    assertEquals(out, [], backend);
  }
});

Deno.test("sandbox probe: no LIMIT line for a backend whose stop reaches every process", async () => {
  const linux: BackendProbe = { ...MAC, os: "linux", sandboxExec: false, bwrap: "usable" };
  const withBwrap = { ...linux, bwrapVersion: "bubblewrap 0.9.0", arch: "x86_64" };
  const { d, out } = deps(withBwrap, () => Promise.reject(new Error("unused")));
  assertEquals(await runSandbox(PROBE, d), 0);
  assertEquals(out.join("\n").split("\n").filter((l) => l.startsWith("LIMIT")), []);
});

Deno.test("sandbox probe: an UNCAPPED line per available backend the table leaves a cap off", async () => {
  const linux: BackendProbe = {
    ...MAC,
    os: "linux",
    arch: "x86_64",
    sandboxExec: false,
    bwrap: "usable",
    bwrapVersion: "bubblewrap 0.9.0",
    bwrapScope: false,
    docker: true,
    image: { kind: "pinned", ref: `acme/dev@sha256:${"e".repeat(64)}` },
  };
  const { d, out } = deps(linux, () => Promise.reject(new Error("unused")));
  await runSandbox(PROBE, d);
  const lines = out.join("\n").split("\n").filter((l) => l.startsWith("UNCAPPED"));
  assertEquals(lines, [...uncapped("container"), ...uncapped("bwrap")]);
});

Deno.test("sandbox exec: a run on a backend without caps is still a run, with its own exit code", async () => {
  const late: ExecOutcome = { ...ran("seatbelt"), outcome: { kind: "exited", code: 3 } };
  const { d, err } = deps(MAC, () => Promise.resolve(late));
  assertEquals(await runSandbox(EXEC, d), 3);
  assertEquals(err.some((l) => l.includes("not run")), false);
});

Deno.test("sandbox probe: bubblewrap in a user scope lacks only what the table says a scope cannot give", async () => {
  const scoped: BackendProbe = {
    ...MAC,
    os: "linux",
    arch: "x86_64",
    sandboxExec: false,
    bwrap: "usable",
    bwrapVersion: "bubblewrap 0.9.0",
    bwrapScope: true,
  };
  const { d, out } = deps(scoped, () => Promise.reject(new Error("unused")));
  await runSandbox(PROBE, d);
  const lines = out.join("\n").split("\n").filter((l) => l.startsWith("UNCAPPED"));
  assertEquals(lines, uncapped("bwrap", true));
  const bare = deps({ ...scoped, bwrapScope: false }, () => Promise.reject(new Error("unused")));
  await runSandbox(PROBE, bare.d);
  const bareLines = bare.out.join("\n").split("\n").filter((l) => l.startsWith("UNCAPPED"));
  assertEquals(bareLines, uncapped("bwrap"));
});
