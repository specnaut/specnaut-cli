import { assert, assertEquals, assertRejects } from "@std/assert";
import { type ExecDeps, execInSandbox } from "../../src/application/sandbox_exec.ts";
import { SandboxRefused } from "../../src/application/sandbox_ports.ts";
import { exportBranchTree } from "../../src/application/untrusted_review.ts";
import { runSandbox } from "../../src/cli/handlers/sandbox_handler.ts";
import type { SandboxIntent } from "../../src/cli/intent.ts";
import { TreeRefused } from "../../src/domain/tree_plan.ts";
import { DenoSubprocessRunner } from "../../src/infrastructure/deno_subprocess.ts";
import { FsSandboxHost } from "../../src/infrastructure/fs_sandbox_host.ts";
import { HostBackendProber } from "../../src/infrastructure/sandbox_probe.ts";
import { cacheEntries, depsOf, fetcherOf, withWorld, type World } from "../helpers/export_world.ts";
import { blob, commit, mktree, type RawEntry } from "../helpers/git_fixture.ts";
import { TEST_SH } from "./isolation_branch.ts";

/**
 * What stops a branch before anything of it runs, on every OS: a tree `git mktree` builds with
 * names the path validator refuses, and a host with no sandbox (Windows), where the branch's tests
 * are reported not run (the caps: `isolation_caps_test.ts`). Each refusal is paired with the same
 * shape going through: a well-formed tree exports, and the Windows case's pair is the
 * live suite's control, where the same test runs on a backend (`isolation_live_test.ts`).
 */

const exportOf = (w: World, head: string) =>
  exportBranchTree(depsOf(w, fetcherOf(w, head)), { source: "origin/topic" });

const hostOf = (w: World) => new FsSandboxHost(w.cache, w.project, () => Promise.resolve(w.repo));

/** Windows has no sandbox, so no run there ever locates an export (`sandbox_host_test.ts`). */
const POSIX = Deno.build.os !== "windows";

/** A well-named tree exports, and its scratch copy is the one a run is given. */
async function assertExports(w: World, id: string): Promise<void> {
  const good = await commit(w.repo, await mktree(w.repo, [["100644", "ok.txt", id]]));
  const exported = await exportOf(w, good);
  if (POSIX) assertEquals((await hostOf(w).locate(good)).tree, exported.scratch);
  await exported.remove();
}

Deno.test("isolation: a git mktree tree naming .git, '..' or a control character exports nothing", () =>
  withWorld(async (w) => {
    const id = await blob(w.repo, "payload\n");
    await assertExports(w, id);
    const config = await blob(w.repo, "[core]\n\tfsmonitor = /bin/true\n");
    const dotGit = await mktree(w.repo, [["100644", "config", config]]);
    const named: RawEntry[] = [["40000", ".git", dotGit], ["100644", "..", id]];
    named.push(["100644", "a\x01b", id]);
    const bad = await commit(w.repo, await mktree(w.repo, [["100644", "ok.txt", id], ...named]));
    const err = await assertRejects(() => exportOf(w, bad), TreeRefused);
    const reasons = err.faults.map((f) => f.slice(f.lastIndexOf(": ") + 2)).sort();
    assertEquals(reasons, ["a '.' or '..' step", "a control character", "a spelling of .git"]);
    assertEquals(await cacheEntries(w), []);
    if (POSIX) await assertRejects(() => hostOf(w).locate(bad), SandboxRefused, "no export of");
  }));

/** A runner factory that records the backend it is asked for, and makes nothing. */
function refusing(made: string[]): ExecDeps["runnerFor"] {
  return (backend) => {
    made.push(backend.kind);
    throw new Error("a runner was made");
  };
}

/**
 * `specnaut sandbox exec` on Windows, over `w`'s export of `head`: its exit code, what it printed,
 * and the backends a runner was made for. On Windows CI these are the host's own facts; elsewhere
 * they stand in for them.
 */
async function execOnWindows(w: World, head: string) {
  const facts = { os: "windows", arch: Deno.build.arch };
  const none = () => Promise.resolve({ kind: "none", why: "not read here" } as const);
  const prober = new HostBackendProber(new DenoSubprocessRunner(), facts, none);
  const made: string[] = [];
  const deps: ExecDeps = { prober, host: hostOf(w), runnerFor: refusing(made) };
  const [out, err]: string[][] = [[], []];
  const command = ["/bin/sh", "./test.sh"];
  const intent = { kind: "sandbox", sub: "exec", sha: head, toolchain: [], command, log: null };
  const code = await runSandbox(intent as SandboxIntent, {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    probe: () => prober.probe(),
    exec: (request) => execInSandbox(deps, request),
  });
  return { code, out, err, made };
}

Deno.test("isolation: on Windows, the branch's test is not run and the run says why", () =>
  withWorld(async (w) => {
    const test = await blob(w.repo, TEST_SH);
    const head = await commit(w.repo, await mktree(w.repo, [["100755", "test.sh", test]]));
    const exported = await exportOf(w, head);
    try {
      const { code, out, err, made } = await execOnWindows(w, head);
      assertEquals(code, 125);
      assertEquals(made, [], "a runner was made");
      assertEquals(out, []);
      assertEquals(err.length, 1);
      assert(err[0].includes("not run: no backend: no sandbox on Windows"), err[0]);
    } finally {
      await exported.remove();
    }
  }));
