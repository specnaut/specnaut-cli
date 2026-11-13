import { assert, assertEquals, assertThrows } from "@std/assert";
import { bwrapArgs, containerArgs } from "../../src/domain/sandbox_args.ts";
import type { SandboxPolicy } from "../../src/domain/sandbox.ts";
import { LIMITS, type ReportedCap } from "../../src/domain/sandbox_limits.ts";
import {
  after,
  PATHS,
  policyOf,
  PROXY_NAMES,
  SCRATCH_HOME,
  SCRATCH_TMP,
} from "./sandbox_fixture.ts";

/**
 * The arguments each launcher is given carry the policy and nothing else: every isolation flag is
 * present, every mount is one the policy names, and no host variable rides along.
 */

const IMAGE = `ghcr.io/acme/dev@sha256:${"b".repeat(64)}`;
const COMMAND = ["deno", "task", "test"];
const NAME = "specnaut-gate-3f9c2a71";
const RUN = { image: IMAGE, name: NAME, engine: "docker", dropped: [] } as const;

const BLANKED = PROXY_NAMES.map((name) => `${name}=`);

const container = () => containerArgs(policyOf("container"), RUN, COMMAND);

const TMPFS = `rw,nosuid,nodev,size=${LIMITS.scratchBytes},mode=1777`;

/** The whole `run` argument list for the fixture's policy, in order. */
const EXPECTED_CONTAINER_ARGS = [
  "run",
  "--rm",
  "--pull",
  "never",
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
  ...BLANKED.flatMap((blank) => ["--env", blank]),
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
  assertEquals(after(args, "--env"), [...BLANKED, `HOME=${SCRATCH_HOME}`, `TMPDIR=${SCRATCH_TMP}`]);
  assertEquals(args.filter((a) => a === "-e" || a.startsWith("--env-file")), []);
});

Deno.test("containerArgs: --cpus is left out where the engine lacks the CPU quota, and only there", () => {
  const without = (dropped: ReportedCap[]) =>
    containerArgs(policyOf("container"), { ...RUN, dropped }, COMMAND).includes("--cpus");
  assertEquals(without(["cpus"]), false);
  assertEquals(without(["memorySwap", "processes", "memoryBytes"]), true);
  // Every other limit an engine lacks is discarded by it, so its option stays.
  const args = containerArgs(policyOf("container"), { ...RUN, dropped: ["cpus"] }, COMMAND);
  assertEquals(after(args, "--memory-swap"), [String(LIMITS.memoryBytes)]);
  assertEquals(after(args, "--pids-limit"), [String(LIMITS.processes)]);
});

Deno.test("containerArgs: on either engine, every proxy variable is set empty; podman copies none", () => {
  for (const engine of ["docker", "podman"] as const) {
    const args = containerArgs(policyOf("container"), { ...RUN, engine }, COMMAND);
    const proxies = after(args, "--env").filter((e) => PROXY_NAMES.includes(e.split("=")[0]));
    assertEquals(proxies, BLANKED, engine);
    const copy = args.filter((a) => a.startsWith("--http-proxy"));
    assertEquals(copy, engine === "podman" ? ["--http-proxy=false"] : [], engine);
  }
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

Deno.test("generators refuse a policy holding a path they cannot pass safely", () => {
  const forged: SandboxPolicy = { ...policyOf("bwrap"), reads: ["/a,src=/,dst=/h"] };
  assertThrows(() => bwrapArgs(forged, COMMAND));
  assertThrows(() => bwrapArgs({ ...policyOf("bwrap"), system: ["/a,b"] }, COMMAND));
  assertThrows(() => bwrapArgs({ ...policyOf("bwrap"), writes: ["/a\nb"] }, COMMAND));
  assertThrows(() => containerArgs({ ...forged, reads: ["/a,ro=false"] }, RUN, COMMAND));
  assertThrows(() => containerArgs({ ...policyOf("container"), writes: ["/a:rw"] }, RUN, COMMAND));
});

Deno.test("containerArgs: the image is never pulled, so a run stays offline", () => {
  assertEquals(after(container(), "--pull"), ["never"]);
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
