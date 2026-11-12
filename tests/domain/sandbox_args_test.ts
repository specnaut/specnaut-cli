import { assert, assertEquals, assertThrows } from "@std/assert";
import { bwrapArgs, containerArgs } from "../../src/domain/sandbox_args.ts";
import { SECCOMP_FD } from "../../src/domain/sandbox_seccomp.ts";
import type { SandboxPolicy } from "../../src/domain/sandbox.ts";
import { CAP_ENFORCEMENT, LIMITS } from "../../src/domain/sandbox_limits.ts";
import { PATHS, policyOf, SCRATCH_HOME, SCRATCH_TMP } from "./sandbox_fixture.ts";

/**
 * The arguments each launcher is given carry the policy and nothing else: every isolation flag is
 * present, every mount is one the policy names, and no host variable rides along.
 */

const IMAGE = `ghcr.io/acme/dev@sha256:${"b".repeat(64)}`;
const COMMAND = ["deno", "task", "test"];
const NAME = "specnaut-gate-3f9c2a71";
const RUN = { image: IMAGE, name: NAME };

/** Each value that follows `flag`, in order. */
function after(args: readonly string[], flag: string): string[] {
  return args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
}

/** The pairs `[a, b]` that follow `flag`, for flags taking two values. */
function pairsAfter(args: readonly string[], flag: string): string[][] {
  return args.flatMap((a, i) => (a === flag ? [[args[i + 1], args[i + 2]]] : []));
}

const container = () => containerArgs(policyOf("container"), RUN, COMMAND);
const bwrap = () => bwrapArgs(policyOf("bwrap"), COMMAND);

const TMPFS = `rw,nosuid,nodev,size=${LIMITS.scratchBytes},mode=1777`;

/** The whole `run` argument list for the fixture's policy, in order. */
const EXPECTED_CONTAINER_ARGS = [
  "run",
  "--rm",
  "--name",
  NAME,
  "--init",
  "--log-driver",
  "none",
  "--network",
  "none",
  "--read-only",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges",
  "--user",
  "65534:65534",
  "--pids-limit",
  String(LIMITS.processes),
  "--memory",
  String(LIMITS.memoryBytes),
  "--memory-swap",
  String(LIMITS.memoryBytes),
  "--cpus",
  String(LIMITS.cpus),
  "--tmpfs",
  `${SCRATCH_HOME}:${TMPFS}`,
  "--tmpfs",
  `${SCRATCH_TMP}:${TMPFS}`,
  "--mount",
  `type=bind,src=${PATHS.tree},dst=${PATHS.tree},readonly=true`,
  "--workdir",
  PATHS.tree,
  "--env",
  `HOME=${SCRATCH_HOME}`,
  "--env",
  `TMPDIR=${SCRATCH_TMP}`,
  IMAGE,
  ...COMMAND,
];

Deno.test("containerArgs: the whole argument list, in order", () => {
  assertEquals(container(), EXPECTED_CONTAINER_ARGS);
});

Deno.test("containerArgs: no network, read-only root, no capabilities, no privilege gain", () => {
  const args = container();
  assertEquals(after(args, "--network"), ["none"]);
  assert(args.includes("--read-only"));
  assertEquals(after(args, "--cap-drop"), ["ALL"]);
  assertEquals(after(args, "--security-opt"), ["no-new-privileges"]);
  assertEquals(after(args, "--user"), ["65534:65534"]);
  assertEquals(args.filter((a) => a === "--cap-add" || a === "--privileged"), []);
});

Deno.test("containerArgs: only the exported tree is mounted, read-only; writes go to tmpfs", () => {
  const args = container();
  assertEquals(after(args, "--mount"), [
    `type=bind,src=${PATHS.tree},dst=${PATHS.tree},readonly=true`,
  ]);
  assertEquals(after(args, "--tmpfs").map((t) => t.split(":")[0]), [SCRATCH_HOME, SCRATCH_TMP]);
  assertEquals(args.filter((a) => a === "-v" || a === "--volume" || a === "--volumes-from"), []);
});

Deno.test("containerArgs: every variable carries its value; none is inherited from the host", () => {
  const args = container();
  assertEquals(after(args, "--env"), [`HOME=${SCRATCH_HOME}`, `TMPDIR=${SCRATCH_TMP}`]);
  assertEquals(args.filter((a) => a === "-e" || a.startsWith("--env-file")), []);
});

Deno.test("containerArgs: the process, memory and CPU caps are set, swap included", () => {
  const args = container();
  assertEquals(after(args, "--pids-limit"), [String(LIMITS.processes)]);
  assertEquals(after(args, "--memory"), [String(LIMITS.memoryBytes)]);
  assertEquals(after(args, "--memory-swap"), [String(LIMITS.memoryBytes)]);
  assertEquals(after(args, "--cpus"), [String(LIMITS.cpus)]);
});

Deno.test("containerArgs: the image is pinned by digest and the command follows it", () => {
  const args = container();
  assertEquals(args.slice(-1 - COMMAND.length), [IMAGE, ...COMMAND]);
  assertThrows(() =>
    containerArgs(policyOf("container"), { ...RUN, image: "ghcr.io/acme/dev:latest" }, COMMAND)
  );
  assertThrows(() =>
    containerArgs(
      policyOf("container"),
      { ...RUN, image: `--privileged@sha256:${"b".repeat(64)}` },
      COMMAND,
    )
  );
});

Deno.test("bwrapArgs: every namespace unshared, tied to its parent, new session, bare environment", () => {
  const args = bwrap();
  assertEquals(args.slice(0, 10), [
    "--unshare-all",
    "--unshare-user",
    "--disable-userns",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--cap-drop",
    "ALL",
    "--seccomp",
    String(SECCOMP_FD),
  ]);
  assertEquals(args.filter((a) => a.startsWith("--share") || a === "--cap-add"), []);
});

Deno.test("bwrapArgs: system folders, the toolchain and the tree are bound read-only", () => {
  const policy = policyOf("bwrap");
  const args = bwrap();
  assertEquals(pairsAfter(args, "--ro-bind-try"), policy.system.map((p) => [p, p]));
  assertEquals(pairsAfter(args, "--ro-bind"), [
    ["/home/dev/.deno/bin", "/home/dev/.deno/bin"],
    [PATHS.tree, PATHS.tree],
  ]);
  assertEquals(args.filter((a) => a === "--bind" || a === "--bind-try" || a === "--dev-bind"), []);
});

Deno.test("bwrapArgs: writes go only to size-capped tmpfs: shared memory and scratch", () => {
  const args = bwrap();
  assertEquals(after(args, "--tmpfs"), ["/dev/shm", SCRATCH_HOME, SCRATCH_TMP]);
  args.forEach((a, i) => {
    if (a === "--tmpfs") {
      assertEquals(args.slice(i - 2, i), ["--size", String(LIMITS.scratchBytes)]);
    }
  });
  assert(args.indexOf("--tmpfs") > args.indexOf("--dev"), "the shm tmpfs replaces --dev's own");
});

Deno.test("bwrapArgs: the sandbox's root is remounted read-only as the last option", () => {
  const args = bwrap();
  const end = args.indexOf("--");
  assertEquals(args.slice(end - 2, end), ["--remount-ro", "/"]);
  assertEquals(after(args, "--remount-ro"), ["/"]);
});

Deno.test("bwrapArgs: the environment is exactly the policy's, and the command follows `--`", () => {
  const policy = policyOf("bwrap");
  const args = bwrap();
  assertEquals(pairsAfter(args, "--setenv"), Object.entries(policy.env));
  assertEquals(after(args, "--chdir"), [PATHS.tree]);
  assertEquals(args.slice(-1 - COMMAND.length), ["--", ...COMMAND]);
  assertEquals(args.filter((a) => a === "--"), ["--"]);
});

Deno.test("generators refuse a policy holding a path they cannot pass safely", () => {
  const forged: SandboxPolicy = { ...policyOf("bwrap"), reads: ["/a,src=/,dst=/h"] };
  assertThrows(() => bwrapArgs(forged, COMMAND));
  assertThrows(() => bwrapArgs({ ...policyOf("bwrap"), system: ["/a,b"] }, COMMAND));
  assertThrows(() => bwrapArgs({ ...policyOf("bwrap"), writes: ["/a\nb"] }, COMMAND));
  assertThrows(() => containerArgs({ ...forged, reads: ["/a,ro=false"] }, RUN, COMMAND));
  assertThrows(() => containerArgs({ ...policyOf("container"), writes: ["/a:rw"] }, RUN, COMMAND));
});

Deno.test("containerArgs: a named run, an init reaping its children, and no engine-kept logs", () => {
  const args = container();
  assertEquals(after(args, "--name"), [NAME]);
  assert(args.includes("--init"));
  assertEquals(after(args, "--log-driver"), ["none"]);
  for (const name of ["", "-x", "a b", "a/b", "a,b", "x".repeat(65)]) {
    assertThrows(
      () => containerArgs(policyOf("container"), { ...RUN, name }, COMMAND),
      Error,
      "",
      name,
    );
  }
});

Deno.test("CAP_ENFORCEMENT: a cap the data puts in the arguments is in them, and no other", () => {
  const ctr = container();
  const wall = (args: readonly string[]) => args.some((a) => a.includes("timeout"));
  const carried = {
    container: {
      processes: after(ctr, "--pids-limit").includes(String(LIMITS.processes)),
      memoryBytes: after(ctr, "--memory").includes(String(LIMITS.memoryBytes)),
      cpus: after(ctr, "--cpus").includes(String(LIMITS.cpus)),
      wallClockSeconds: wall(ctr),
      scratchBytes: after(ctr, "--tmpfs").every((t) => t.includes(`size=${LIMITS.scratchBytes}`)),
    },
    bwrap: {
      processes: false,
      memoryBytes: false,
      cpus: false,
      wallClockSeconds: wall(bwrap()),
      scratchBytes: after(bwrap(), "--size").length === after(bwrap(), "--tmpfs").length,
    },
    seatbelt: {
      processes: false,
      memoryBytes: false,
      cpus: false,
      wallClockSeconds: false,
      scratchBytes: false,
    },
  };
  for (const [backend, caps] of Object.entries(carried)) {
    const expected = Object.fromEntries(
      Object.entries(caps).map(([cap, inArgs]) => [cap, inArgs ? "arguments" : "launcher"]),
    );
    assertEquals(CAP_ENFORCEMENT[backend as keyof typeof CAP_ENFORCEMENT], expected, backend);
  }
});
