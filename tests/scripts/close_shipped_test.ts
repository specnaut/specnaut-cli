import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { backlog } from "./close_shipped_fixture.ts";

/**
 * spec 042 — close-shipped.sh, one copy per backend, one exit contract. The
 * backlog scripts it calls are stubs that record their arguments, so what is
 * asserted is the order and the gate, not a backend's network. Except the
 * gitlab sweep: the real `sweep-closed.sh` runs, over a stubbed `glab`, so a
 * flag its parser rejects fails here and not on a user's board.
 */

Deno.test("github: a closed issue moves to Done, then the board is swept and drift batch-moved", async () => {
  const b = await backlog("github", { closed: { "7": 12 }, drifted: ["3", "4"] });
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
    const b = await backlog(backend, { closed: { "7": 0, "8": 11, "9": 3, "10": 12 } });
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

Deno.test("gitlab reconciles through its real sweep, one move at a time; local and cloud move, which is the close", async () => {
  const g = await backlog("gitlab", { closed: { "7": 12 }, drifted: ["3"] });
  try {
    const r = await g.run("7");
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertStringIncludes(r.stdout, "RECONCILED #3");
    assertStringIncludes(r.stdout, "scanned 2, drifted 1, reopened 0");
    assertEquals((await g.calls()).slice(-1), ["move.sh 3 Done"]);
  } finally {
    await g.cleanup();
  }
  for (const backend of ["local", "cloud"]) {
    const b = await backlog(backend);
    try {
      const r = await b.run("7", "8");
      assertEquals(r.code, 0, r.stdout);
      assertEquals(await b.calls(), ["move.sh 7 Done", "move.sh 8 Done"], backend);
    } finally {
      await b.cleanup();
    }
  }
});

Deno.test("a move or the reconcile that fails is 21 and a FAILED line, on every backend", async () => {
  // [backend, the call that fails, what the line says]
  const cases: ReadonlyArray<[string, string, string]> = [
    ["github", "move.sh 7 Done", "FAILED #7"],
    ["github", "sweep-closed.sh", "FAILED reconcile"],
    ["github", "move-batch.sh", "FAILED reconcile"],
    ["gitlab", "move.sh 7 Done", "FAILED #7"],
    ["gitlab", "sweep-closed.sh", "FAILED reconcile"],
    ["gitlab", "move.sh 3 Done", "FAILED #3"],
    ["local", "move.sh 7 Done", "FAILED #7"],
    ["cloud", "move.sh 7 Done", "FAILED #7"],
  ];
  for (const [backend, fail, line] of cases) {
    const b = await backlog(backend, { closed: { "7": 12 }, drifted: ["3"], fail: [fail] });
    try {
      const r = await b.run("7");
      assertEquals(r.code, 21, `${backend}, ${fail} failing: ${r.stdout}${r.stderr}`);
      assertStringIncludes(r.stdout, line, `${backend}, ${fail} failing`);
    } finally {
      await b.cleanup();
    }
  }
});

Deno.test("every copy takes issue numbers only", async () => {
  for (const backend of ["github", "gitlab", "local", "cloud"]) {
    const b = await backlog(backend);
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

Deno.test("one body, installed once per backend: the manifest lists _close_shipped.sh for all four", async () => {
  // A backend-less entry would ship a backlog script to every backend (backend_gating_test).
  const manifest = JSON.parse(
    await Deno.readTextFile(new URL("../../templates/manifest.json", import.meta.url)),
  );
  const entries = manifest.core
    .filter((e: { source?: string }) => e?.source === "core/skills/task/scripts/_close_shipped.sh");
  assertEquals(
    entries.map((e: { name: string; suffix: string; backend: string }) =>
      `${e.backend} ${e.name} ${e.suffix}`
    ).sort(),
    [
      "cloud _close_shipped _close_shipped.sh",
      "github _close_shipped _close_shipped.sh",
      "gitlab _close_shipped _close_shipped.sh",
      "local _close_shipped _close_shipped.sh",
    ],
  );
});

Deno.test("cascade-check's stderr reaches the reader; its stdout, the issue titles, does not", async () => {
  for (const backend of ["github", "gitlab"]) {
    const b = await backlog(backend);
    try {
      await Deno.writeTextFile(
        join(b.scripts, "cascade-check.sh"),
        "echo 'TITLE of the issue'\necho 'cascade-check: the forge refused the token' >&2\nexit 3\n",
      );
      const r = await b.run("7");
      assertEquals(r.code, 20, `${backend}: ${r.stdout}${r.stderr}`);
      assertStringIncludes(r.stderr, "the forge refused the token", backend);
      assertStringIncludes(
        r.stdout,
        "OPEN #7 — not confirmed closed (cascade-check exit 3)",
        backend,
      );
      assert(!(r.stdout + r.stderr).includes("TITLE"), `${backend}: the titles leaked`);
    } finally {
      await b.cleanup();
    }
  }
});
