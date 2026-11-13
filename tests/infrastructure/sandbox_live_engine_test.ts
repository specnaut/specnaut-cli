import { assertEquals } from "@std/assert";
import { type BackendProbe, chooseBackend } from "../../src/domain/sandbox.ts";
import { MAC } from "../cli/sandbox_handler_fixture.ts";
import { liveEngine } from "./sandbox_live_engine.ts";

/** The live container tests run on the engine a run would be offered, whichever hosts offer both. */

const ALL = { memory: true, swap: true, pids: true, cpuQuota: true };
const NONE = { memory: false, swap: false, pids: false, cpuQuota: false };
const IMAGE = { kind: "pinned", ref: `acme/dev@sha256:${"f".repeat(64)}` } as const;

Deno.test("live engine: the one a run is offered, podman ahead of docker as the domain ranks them", () => {
  for (const podman of ["rootless", "root", "absent"] as const) {
    for (const podmanLimits of [ALL, NONE]) {
      for (const docker of [true, false]) {
        const probe: BackendProbe = { ...MAC, image: IMAGE, podman, podmanLimits, docker };
        const chosen = chooseBackend(probe);
        if (chosen.kind !== "container") continue;
        assertEquals(liveEngine(probe), chosen.engine, JSON.stringify({ podman, docker }));
      }
    }
  }
});

Deno.test("live engine: with no engine offered, any podman is still driven by hand", () => {
  const probe: BackendProbe = { ...MAC, podman: "rootless", podmanLimits: NONE, docker: false };
  assertEquals(liveEngine(probe), "podman");
  assertEquals(liveEngine({ ...probe, podman: "absent" }), null);
});
