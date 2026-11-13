import { assertEquals } from "@std/assert";
import { runSandbox } from "../../src/cli/handlers/sandbox_handler.ts";
import type { ExecOutcome } from "../../src/application/sandbox_exec.ts";
import { SandboxRefused } from "../../src/application/sandbox_ports.ts";
import { STOP_LIMIT } from "../../src/domain/sandbox_limits.ts";
import { deps, EXEC, MAC, PROBE, uncapped } from "./sandbox_handler_fixture.ts";

/**
 * `specnaut sandbox`'s output and exit codes: `probe` lists every backend, then the one chosen;
 * `exec` exits with the command's code, 124 when the wall clock ran out, 125 when nothing ran.
 */

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

Deno.test("sandbox exec: a stop that failed at the wall clock is said after the timeout", async () => {
  const late: ExecOutcome = {
    kind: "ran",
    backend: "container",
    outcome: { kind: "timed_out", seconds: 60, haltFailed: "docker rm --force n exited 1" },
    unenforced: [],
  };
  const { d, err } = deps(MAC, () => Promise.resolve(late));
  assertEquals(await runSandbox(EXEC, d), 124);
  const said = err.join("\n");
  assertEquals(said.includes("the wall clock ran out after 60 s"), true);
  assertEquals(said.includes("not stopped cleanly: docker rm --force n exited 1"), true, said);
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

const NOT_RUN: ExecOutcome = { kind: "not_run", why: "unreached" };

Deno.test("sandbox exec: a run the review lock refuses is 125, its reason said, nothing run", async () => {
  let ran = false;
  const exec = () => Promise.resolve(void (ran = true)).then(() => NOT_RUN);
  const { d, err } = deps(MAC, exec, "--toolchain is refused under the review lock");
  assertEquals(await runSandbox(EXEC, d), 125);
  assertEquals(ran, false);
  assertEquals(
    err.join("\n").includes("not run: --toolchain is refused under the review lock"),
    true,
  );
});
