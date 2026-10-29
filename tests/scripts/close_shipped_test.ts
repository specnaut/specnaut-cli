import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { run } from "./git_sandbox.ts";

/**
 * spec 042 — close-shipped.sh, one copy per backend, one exit contract. The
 * backlog scripts it calls are stubs that record their arguments, so what is
 * asserted is the order and the gate, not a backend's network.
 */

const SCRIPTS = fromFileUrl(new URL("../../templates/core/skills/task/scripts/", import.meta.url));

/** closed: issue → cascade-check exit (12 = closed). drifted: numbers the sweep reports. */
async function backlog(backend: string, closed: Record<string, number>, drifted: string[] = []) {
  const dir = await Deno.makeTempDir({ prefix: `specnaut-close-${backend}-` });
  await Deno.copyFile(join(SCRIPTS, backend, "close-shipped.sh"), join(dir, "close-shipped.sh"));
  const log = join(dir, "calls.log");
  const stub = (name: string, body: string) =>
    Deno.writeTextFile(
      join(dir, name),
      `#!/usr/bin/env bash\necho "${name} $*" >> "${log}"\n${body}\n`,
    );
  const cases = Object.entries(closed).map(([n, c]) => `${n}) exit ${c} ;;`).join(" ");
  await stub("cascade-check.sh", `case $1 in ${cases} *) exit 3 ;; esac`);
  await stub("move.sh", "exit 0");
  await stub("move-batch.sh", "exit 0");
  const lines = drifted.map((d) => `echo "DRIFTED  ${d} In progress"`).join("\n");
  await stub(
    "sweep-closed.sh",
    `${lines}\necho "scanned 9, drifted ${drifted.length}, reopened 0"`,
  );
  return {
    run: (...args: string[]) => run("bash", [join(dir, "close-shipped.sh"), ...args], dir),
    calls: async () =>
      (await Deno.readTextFile(log).catch(() => "")).trim().split("\n").filter(Boolean),
    cleanup: () => Deno.remove(dir, { recursive: true }),
  };
}

Deno.test("github: a closed issue moves to Done, then the board is swept and drift batch-moved", async () => {
  const b = await backlog("github", { "7": 12 }, ["3", "4"]);
  try {
    const r = await b.run("7");
    assertEquals(r.code, 0, r.stdout);
    assertStringIncludes(r.stdout, "DONE #7");
    assertStringIncludes(r.stdout, "RECONCILED #3");
    assertStringIncludes(r.stdout, "scanned 9, drifted 2, reopened 0");
    assertEquals(await b.calls(), [
      "cascade-check.sh 7",
      "move.sh 7 Done",
      "sweep-closed.sh --passes 2",
      "move-batch.sh Done 3 4",
    ]);
  } finally {
    await b.cleanup();
  }
});

Deno.test("an issue not confirmed closed keeps its card, and the exit says so", async () => {
  for (const backend of ["github", "gitlab"]) {
    // 0 = open with no open children, 11 = open children, 3 = could not answer: none is "closed".
    const b = await backlog(backend, { "7": 0, "8": 11, "9": 3, "10": 12 });
    try {
      const r = await b.run("7", "8", "9", "10");
      assertEquals(r.code, 20, `${backend}: ${r.stdout}`);
      const moves = (await b.calls()).filter((c) => c.startsWith("move.sh"));
      assertEquals(moves, ["move.sh 10 Done"], `${backend}: a card moved over an open issue`);
    } finally {
      await b.cleanup();
    }
  }
});

Deno.test("gitlab reconciles drift one move at a time; local and cloud move, which is the close", async () => {
  const g = await backlog("gitlab", { "7": 12 }, ["3"]);
  try {
    assertEquals((await g.run("7")).code, 0);
    assertEquals((await g.calls()).slice(-1), ["move.sh 3 Done"]);
  } finally {
    await g.cleanup();
  }
  for (const backend of ["local", "cloud"]) {
    const b = await backlog(backend, {});
    try {
      const r = await b.run("7", "8");
      assertEquals(r.code, 0, r.stdout);
      assertEquals(await b.calls(), ["move.sh 7 Done", "move.sh 8 Done"], backend);
    } finally {
      await b.cleanup();
    }
  }
});

Deno.test("every copy takes issue numbers only", async () => {
  for (const backend of ["github", "gitlab", "local", "cloud"]) {
    const b = await backlog(backend, {});
    try {
      for (const bad of [[], ["#7"], ["owner/repo#7"], ["7;rm"], ["0"]]) {
        assertEquals((await b.run(...bad)).code, 2, `${backend} ${bad.join(" ")}`);
      }
      assertEquals(await b.calls(), [], `${backend}: a refused call still ran a backlog script`);
    } finally {
      await b.cleanup();
    }
  }
});
