import { assertEquals } from "@std/assert";
import { type BackendProbe, chooseBackend } from "../../src/domain/sandbox.ts";
import type { ImageSource } from "../../src/domain/sandbox_image.ts";

/**
 * Which isolation backend runs a branch's gates: a container first, then bubblewrap, then
 * `sandbox-exec`, else nothing runs and the review is static only. A throwaway user is no backend.
 */

const IMAGE: ImageSource = { kind: "pinned", ref: `acme/dev@sha256:${"a".repeat(64)}` };
const CGROUPS_WHY =
  "container: rootless podman without cgroup v2 pids, memory and cpu delegated, and no docker";
const NO_IMAGE: ImageSource = { kind: "none", why: "no devcontainer" };

const NOTHING: BackendProbe = {
  os: "linux",
  image: IMAGE,
  podman: "absent",
  podmanCgroups: false,
  docker: false,
  bwrap: "absent",
  sandboxExec: false,
};

const probe = (over: Partial<BackendProbe>): BackendProbe => ({ ...NOTHING, ...over });

Deno.test("chooseBackend: rootless podman comes first, ahead of docker and bubblewrap", () => {
  const all = probe({ podman: "rootless", podmanCgroups: true, docker: true, bwrap: "usable" });
  assertEquals(chooseBackend(all), { kind: "container", engine: "podman", image: IMAGE.ref });
});

Deno.test("chooseBackend: podman running as root is passed over for docker", () => {
  const rooted = probe({ podman: "root", docker: true, bwrap: "usable" });
  assertEquals(chooseBackend(rooted), { kind: "container", engine: "docker", image: IMAGE.ref });
});

Deno.test("chooseBackend: rootless podman without delegated cgroups cannot cap a run", () => {
  const uncapped = probe({ podman: "rootless", docker: true });
  assertEquals(chooseBackend(uncapped), { kind: "container", engine: "docker", image: IMAGE.ref });
  const alone = chooseBackend(probe({ podman: "rootless", bwrap: "usable" }));
  assertEquals(alone, { kind: "bwrap" });
  const nothing = chooseBackend(probe({ podman: "rootless" }));
  assertEquals(nothing.kind === "static" && nothing.why[0], CGROUPS_WHY);
});

Deno.test("chooseBackend: docker comes before bubblewrap", () => {
  const both = probe({ docker: true, bwrap: "usable" });
  assertEquals(chooseBackend(both), { kind: "container", engine: "docker", image: IMAGE.ref });
});

Deno.test("chooseBackend: no digest-pinned image means no container, whatever engine exists", () => {
  const engines = probe({
    image: NO_IMAGE,
    podman: "rootless",
    podmanCgroups: true,
    docker: true,
    bwrap: "usable",
  });
  assertEquals(chooseBackend(engines), { kind: "bwrap" });
});

Deno.test("chooseBackend: bubblewrap blocked by the user-namespace restriction is passed over", () => {
  const restricted = probe({ bwrap: "userns_restricted" });
  const chosen = chooseBackend(restricted);
  assertEquals(chosen.kind, "static");
  if (chosen.kind === "static") {
    assertEquals(chosen.why.some((w) => w.includes("user namespaces")), true);
  }
});

Deno.test("chooseBackend: bubblewrap is a Linux backend only", () => {
  assertEquals(chooseBackend(probe({ os: "darwin", bwrap: "usable" })).kind, "static");
});

Deno.test("chooseBackend: sandbox-exec on macOS when no container runs", () => {
  const mac = probe({ os: "darwin", image: NO_IMAGE, docker: true, sandboxExec: true });
  assertEquals(chooseBackend(mac), { kind: "seatbelt" });
});

Deno.test("chooseBackend: sandbox-exec is a macOS backend only", () => {
  assertEquals(chooseBackend(probe({ sandboxExec: true })).kind, "static");
});

Deno.test("chooseBackend: Windows is static only, even with an engine and a pinned image", () => {
  const win = probe({ os: "windows", podman: "rootless", podmanCgroups: true, docker: true });
  const chosen = chooseBackend(win);
  assertEquals(chosen.kind, "static");
  if (chosen.kind === "static") assertEquals(chosen.why.length, 1);
});

Deno.test("chooseBackend: with no backend it is static only, and says why for each one", () => {
  const chosen = chooseBackend(probe({ image: NO_IMAGE }));
  assertEquals(chosen.kind, "static");
  if (chosen.kind === "static") {
    assertEquals(chosen.why, [
      "no container image: no devcontainer",
      "bubblewrap: not installed",
    ]);
  }
});
