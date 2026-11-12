import { assertEquals } from "@std/assert";
import { bwrapArgs, containerArgs } from "../../src/domain/sandbox_args.ts";
import { CAP_ENFORCEMENT, LIMITS } from "../../src/domain/sandbox_limits.ts";
import { after, policyOf } from "./sandbox_fixture.ts";

/** Where each resource cap is applied: a cap the data puts in a backend's arguments is in them. */

const COMMAND = ["deno", "task", "test"];
const RUN = { image: `ghcr.io/acme/dev@sha256:${"b".repeat(64)}`, name: "specnaut-gate-3f9c2a71" };
const container = () => containerArgs(policyOf("container"), RUN, COMMAND);
const bwrap = () => bwrapArgs(policyOf("bwrap"), COMMAND);

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
