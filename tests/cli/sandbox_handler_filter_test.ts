import { assertEquals } from "@std/assert";
import { runSandbox } from "../../src/cli/handlers/sandbox_handler.ts";
import type { ExecOutcome } from "../../src/application/sandbox_exec.ts";
import type { FilterRecord } from "../../src/domain/sandbox_filter_probe.ts";
import { deps, EXEC, MAC, ran } from "./sandbox_handler_fixture.ts";

/**
 * What a container run says of its syscall filter, after its gaps: the names its probe saw
 * applied, then, as a warning, the names the runtime dropped, or why the probe could not tell.
 */

const PREFIX = "specnaut sandbox exec: SECCOMP container";

/** The stderr lines of a container run whose probe recorded `filter`, past the gaps. */
async function filterLines(filter: FilterRecord): Promise<string[]> {
  const run = ran("container");
  const outcome: ExecOutcome = { ...run, outcome: { kind: "exited", code: 0, filter } };
  const { d, err, out } = deps(MAC, () => Promise.resolve(outcome));
  assertEquals(await runSandbox(EXEC, d), 0);
  assertEquals(out, []);
  return err.filter((l) => l.includes("SECCOMP"));
}

Deno.test("sandbox exec: a container run names the filter names its probe saw applied", async () => {
  const filter = { kind: "observed", applied: ["mount", "clone3"], dropped: [] } as const;
  assertEquals(await filterLines(filter), [`notice: ${PREFIX} applied mount,clone3`]);
});

Deno.test("sandbox exec: a name the runtime dropped is named dropped, as a warning", async () => {
  const filter = { kind: "observed", applied: ["mount"], dropped: ["open_tree_attr"] } as const;
  assertEquals(await filterLines(filter), [
    `notice: ${PREFIX} applied mount`,
    `warning: ${PREFIX} dropped open_tree_attr`,
  ]);
});

Deno.test("sandbox exec: a probe that could not tell is said, its reason made inert", async () => {
  const filter = {
    kind: "unobserved",
    why: "the filter probe exited 2: \x1b[31mno\x1b[0m",
  } as const;
  assertEquals(await filterLines(filter), [
    `warning: ${PREFIX} unobserved the filter probe exited 2: \\u001b[31mno\\u001b[0m`,
  ]);
});

Deno.test("sandbox exec: a run with no record says nothing of a filter", async () => {
  const { d, err } = deps(MAC, () => Promise.resolve(ran("bwrap")));
  assertEquals(await runSandbox(EXEC, d), 0);
  assertEquals(err.filter((l) => l.includes("SECCOMP")), []);
});
