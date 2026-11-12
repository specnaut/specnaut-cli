import { assertEquals } from "@std/assert";
import { runSandbox } from "../../src/cli/handlers/sandbox_handler.ts";
import type { ExecOutcome } from "../../src/application/sandbox_exec.ts";
import type { BackendProbe } from "../../src/domain/sandbox.ts";
import { STOP_LIMIT } from "../../src/domain/sandbox_limits.ts";
import { deps, EXEC, MAC, PROBE, ran, uncapped } from "./sandbox_handler_fixture.ts";

/** What a run goes without, as probe and exec say it: UNCAPPED caps and the LIMIT of its stop. */

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

Deno.test("sandbox probe: docker on a host that cannot apply a limit runs UNCAPPED for its cap", async () => {
  const docker: BackendProbe = {
    ...MAC,
    os: "linux",
    sandboxExec: false,
    docker: true,
    dockerLimits: { memory: true, swap: false, pids: false, cpuQuota: true },
    image: { kind: "pinned", ref: `acme/dev@sha256:${"e".repeat(64)}` },
  };
  const { d, out } = deps(docker, () => Promise.reject(new Error("unused")));
  await runSandbox(PROBE, d);
  const lines = out.join("\n").split("\n").filter((l) => l.startsWith("UNCAPPED"));
  assertEquals(lines, ["UNCAPPED container processes,memory"]);
});
