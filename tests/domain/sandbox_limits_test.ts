import { assertEquals } from "@std/assert";
import { containerArgs } from "../../src/domain/sandbox_args.ts";
import { bwrapArgs, scopeArgs } from "../../src/domain/sandbox_bwrap_args.ts";
import {
  CAP_ENFORCEMENT,
  CAP_NAMES,
  capsWithout,
  engineDrops,
  LIMITS,
  STOP_LIMIT,
  unenforcedCaps,
} from "../../src/domain/sandbox_limits.ts";
import { after, policyOf } from "./sandbox_fixture.ts";

/**
 * Where each resource cap is applied: a cap the data puts in a backend's arguments is in them,
 * and one it puts in bubblewrap's user scope is in the scope's.
 */

const COMMAND = ["deno", "task", "test"];
const RUN = {
  image: `ghcr.io/acme/dev@sha256:${"b".repeat(64)}`,
  name: "specnaut-gate-3f9c2a71",
  engine: "docker",
  dropped: [],
} as const;
const container = () => containerArgs(policyOf("container"), RUN, COMMAND);
const bwrap = () => bwrapArgs(policyOf("bwrap"), COMMAND);
const scope = () => after(scopeArgs(policyOf("bwrap")), "-p");

/** What the table must say of `cap`, given where the arguments were found to carry it. */
function enforcer(cap: string, by: boolean | string): string {
  if (by === "scope") return "scope";
  return by ? "arguments" : cap === "wallClockSeconds" ? "launcher" : "unenforced";
}

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
      processes: scope().includes(`TasksMax=${LIMITS.processes}`) && "scope",
      memoryBytes: scope().includes(`MemoryMax=${LIMITS.memoryBytes}`) && "scope",
      cpus: scope().includes(`CPUQuota=${LIMITS.cpus * 100}%`) && "scope",
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
      Object.entries(caps).map(([cap, by]) => [cap, enforcer(cap, by)]),
    );
    assertEquals(CAP_ENFORCEMENT[backend as keyof typeof CAP_ENFORCEMENT], expected, backend);
  }
});

Deno.test("unenforcedCaps: the container runs with every cap; the others name what they lack", () => {
  assertEquals(unenforcedCaps("container"), []);
  assertEquals(unenforcedCaps("bwrap"), ["processes", "memoryBytes", "cpus"]);
  assertEquals(unenforcedCaps("seatbelt"), ["processes", "memoryBytes", "cpus", "scratchBytes"]);
});

Deno.test("unenforcedCaps: bubblewrap in a user scope lacks none; a scope means nothing elsewhere", () => {
  assertEquals(unenforcedCaps("bwrap", true), []);
  assertEquals(unenforcedCaps("seatbelt", true), unenforcedCaps("seatbelt"));
  assertEquals(unenforcedCaps("container", true), []);
});

const ALL = { memory: true, swap: true, pids: true, cpuQuota: true };

Deno.test("engineDrops: each limit an engine's host lacks drops its own cap, and only that", () => {
  assertEquals(engineDrops(ALL), []);
  assertEquals(engineDrops({ ...ALL, memory: false }), ["memoryBytes"]);
  // The memory a run holds stays bound: only the bound on what it pages out is reported.
  assertEquals(engineDrops({ ...ALL, swap: false }), ["memorySwap"]);
  assertEquals(engineDrops({ ...ALL, memory: false, swap: false }), ["memoryBytes", "memorySwap"]);
  assertEquals(engineDrops({ ...ALL, pids: false }), ["processes"]);
  assertEquals(engineDrops({ ...ALL, cpuQuota: false }), ["cpus"]);
});

Deno.test("capsWithout: a container lacks what its engine drops, in the table's order", () => {
  const docker = { kind: "container", engine: "docker", image: RUN.image } as const;
  assertEquals(capsWithout({ ...docker, dropped: [] }), []);
  assertEquals(capsWithout({ ...docker, dropped: ["cpus", "processes"] }), ["processes", "cpus"]);
  assertEquals(capsWithout({ kind: "bwrap", scope: false }), unenforcedCaps("bwrap"));
});

Deno.test("STOP_LIMIT: only sandbox-exec's stop misses a process that left the run's group", () => {
  assertEquals(STOP_LIMIT.container, null);
  assertEquals(STOP_LIMIT.bwrap, null);
  assertEquals(typeof STOP_LIMIT.seatbelt, "string");
});

Deno.test("CAP_NAMES: one plain, distinct name per cap, as the probe prints it", () => {
  assertEquals(Object.keys(CAP_NAMES).sort(), [...Object.keys(LIMITS), "memorySwap"].sort());
  const names = Object.values(CAP_NAMES);
  assertEquals(new Set(names).size, names.length);
  for (const name of names) assertEquals(/^[a-z][a-z-]*$/.test(name), true, name);
});
