import { assertEquals, assertRejects } from "@std/assert";
import { type ExecDeps, execInSandbox } from "../../src/application/sandbox_exec.ts";
import {
  type HostFolders,
  type RunnableBackend,
  type RunOutcome,
  SandboxRefused,
} from "../../src/application/sandbox_ports.ts";
import type { BackendProbe, SandboxPolicy } from "../../src/domain/sandbox.ts";
import { sandboxPolicy } from "../../src/domain/sandbox.ts";
import { unenforcedCaps } from "../../src/domain/sandbox_limits.ts";

/**
 * Running a command on an export in a sandbox: the backend `chooseBackend` picks, the policy
 * `sandboxPolicy` makes over the host's folders, the runner for that backend, and a scratch folder
 * removed whatever happens. Static only, or a layout the policy refuses, runs nothing.
 */

const SHA = "a".repeat(40);
const FOLDERS: HostFolders = {
  tree: "/cache/specnaut/untrusted/aaa/scratch",
  home: "/home/dev",
  checkout: "/home/dev/src/my-app",
};
const SCRATCH = "/tmp/specnaut-sandbox-1";
const IMAGE = `acme/dev@sha256:${"b".repeat(64)}`;

const LINUX_BWRAP: BackendProbe = {
  os: "linux",
  arch: "x86_64",
  image: { kind: "none", why: "no devcontainer" },
  podman: "absent",
  podmanRemote: false,
  podmanVersion: null,
  podmanLimits: { memory: false, swap: false, pids: false, cpuQuota: false },
  podmanCpus: null,
  docker: false,
  dockerOnPodman: false,
  dockerLimits: { memory: true, swap: true, pids: true, cpuQuota: true },
  dockerCpus: null,
  bwrap: "usable",
  bwrapVersion: "bubblewrap 0.9.0",
  bwrapScope: false,
  sandboxExec: false,
};

type Seen = {
  located: string[];
  removed: number;
  runs: { backend: RunnableBackend; policy: SandboxPolicy; command: readonly string[] }[];
};

/** A link as the host resolves it: the one folder the tests make a link of, to the home. */
const LINKS: Record<string, string> = { "/opt/tools": "/home/dev" };

function world(probe: BackendProbe, outcome: RunOutcome = { kind: "exited", code: 7 }) {
  const seen: Seen = { located: [], removed: 0, runs: [] };
  const deps: ExecDeps = {
    prober: { probe: () => Promise.resolve(probe) },
    host: {
      locate: (sha) => {
        seen.located.push(sha);
        return Promise.resolve(FOLDERS);
      },
      real: (folders) => Promise.resolve(folders.map((f) => LINKS[f] ?? f)),
      scratch: () =>
        Promise.resolve({
          path: SCRATCH,
          remove: () => {
            seen.removed++;
            return Promise.resolve();
          },
        }),
    },
    runnerFor: (backend) => ({
      run: (policy, command) => {
        seen.runs.push({ backend, policy, command });
        return Promise.resolve(outcome);
      },
    }),
  };
  return { deps, seen };
}

const REQUEST = { sha: SHA, toolchain: ["/opt/deno/bin"], command: ["deno", "test"] };

Deno.test("execInSandbox: the chosen backend's runner runs the command under its policy", async () => {
  const { deps, seen } = world(LINUX_BWRAP);
  const result = await execInSandbox(deps, REQUEST);
  assertEquals(result, {
    kind: "ran",
    backend: "bwrap",
    outcome: { kind: "exited", code: 7 },
    unenforced: unenforcedCaps("bwrap"),
  });
  assertEquals(seen.located, [SHA]);
  assertEquals(seen.runs.length, 1);
  const expected = sandboxPolicy("bwrap", {
    ...FOLDERS,
    scratch: SCRATCH,
    toolchain: ["/opt/deno/bin"],
    path: ["/opt/deno/bin"],
  });
  assertEquals(expected.ok && seen.runs[0].policy, expected.ok && expected.policy);
  assertEquals(seen.runs[0].backend, { kind: "bwrap", scope: false });
  assertEquals(seen.runs[0].command, ["deno", "test"]);
  assertEquals(seen.removed, 1);
});

Deno.test("execInSandbox: a container runner is handed its engine and pinned image", async () => {
  const probe: BackendProbe = {
    ...LINUX_BWRAP,
    docker: true,
    image: { kind: "pinned", ref: IMAGE },
  };
  const { deps, seen } = world(probe);
  await execInSandbox(deps, REQUEST);
  assertEquals(seen.runs[0].backend, {
    kind: "container",
    engine: "docker",
    image: IMAGE,
    dropped: [],
    cpus: null,
  });
  assertEquals(seen.runs[0].policy.reads, [FOLDERS.tree]);
});

Deno.test("execInSandbox: static only runs nothing, makes no scratch, and says why", async () => {
  const { deps, seen } = world({ ...LINUX_BWRAP, bwrap: "absent" });
  assertEquals(await execInSandbox(deps, REQUEST), {
    kind: "not_run",
    why: "no backend: no container image: no devcontainer; bubblewrap: not installed",
  });
  assertEquals(seen, { located: [SHA], removed: 0, runs: [] });
});

Deno.test("execInSandbox: a layout the policy refuses runs nothing, and the scratch goes", async () => {
  const { deps, seen } = world(LINUX_BWRAP);
  const result = await execInSandbox(deps, { ...REQUEST, toolchain: ["/home/dev/src/my-app/bin"] });
  assertEquals(result, {
    kind: "not_run",
    why: "/home/dev/src/my-app/bin overlaps the checkout",
  });
  assertEquals(seen.runs, []);
  assertEquals(seen.removed, 1);
});

Deno.test("execInSandbox: a runner that throws still has the scratch removed", async () => {
  const { deps, seen } = world(LINUX_BWRAP);
  const failing = { run: () => Promise.reject(new Error("launcher gone")) };
  const run = () => execInSandbox({ ...deps, runnerFor: () => failing }, REQUEST);
  await assertRejects(run, Error, "launcher gone");
  assertEquals(seen.removed, 1);
});

Deno.test("execInSandbox: an export that is not there is refused before any probe or scratch", async () => {
  const { deps, seen } = world(LINUX_BWRAP);
  const locate = () => Promise.reject(new SandboxRefused("no export of that commit"));
  const prober = { probe: () => Promise.reject(new Error("an engine was asked")) };
  const run = () => execInSandbox({ ...deps, prober, host: { ...deps.host, locate } }, REQUEST);
  await assertRejects(run, SandboxRefused, "no export");
  assertEquals(seen.removed, 0);
});

Deno.test("execInSandbox: the wall clock's end is reported, not turned into an exit code", async () => {
  const { deps } = world(LINUX_BWRAP, { kind: "timed_out", seconds: 1800 });
  assertEquals(await execInSandbox(deps, REQUEST), {
    kind: "ran",
    backend: "bwrap",
    outcome: { kind: "timed_out", seconds: 1800 },
    unenforced: unenforcedCaps("bwrap"),
  });
});

Deno.test("execInSandbox: a toolchain folder is judged by where it leads, never by its name", async () => {
  const { deps, seen } = world(LINUX_BWRAP);
  const result = await execInSandbox(deps, { ...REQUEST, toolchain: ["/opt/tools"] });
  assertEquals(result, { kind: "not_run", why: "/home/dev is or holds the home folder" });
  assertEquals(seen.runs, []);
});

Deno.test("execInSandbox: a run carries the caps its backend ran without, from the table", async () => {
  const container = {
    ...LINUX_BWRAP,
    docker: true,
    image: { kind: "pinned", ref: IMAGE },
  } as const;
  const ran = await execInSandbox(world(container).deps, REQUEST);
  assertEquals(ran.kind === "ran" && ran.unenforced, unenforcedCaps("container"));
  const bwrap = await execInSandbox(world(LINUX_BWRAP).deps, REQUEST);
  assertEquals(bwrap.kind === "ran" && bwrap.unenforced, unenforcedCaps("bwrap"));
});

Deno.test("execInSandbox: bubblewrap in a user scope is handed the scope, and lacks none of its caps", async () => {
  const { deps, seen } = world({ ...LINUX_BWRAP, bwrapScope: true });
  const ran = await execInSandbox(deps, REQUEST);
  assertEquals(seen.runs[0].backend, { kind: "bwrap", scope: true });
  assertEquals(ran.kind === "ran" && ran.unenforced, unenforcedCaps("bwrap", true));
});
