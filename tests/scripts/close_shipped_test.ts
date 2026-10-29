import { assertEquals, assertStringIncludes } from "@std/assert";
import { DELIMITER, fromFileUrl, join } from "@std/path";
import { run } from "./git_sandbox.ts";

/**
 * spec 042 — close-shipped.sh, one copy per backend, one exit contract. The
 * backlog scripts it calls are stubs that record their arguments, so what is
 * asserted is the order and the gate, not a backend's network. Except the
 * gitlab sweep: the real `sweep-closed.sh` runs, over a stubbed `glab`, so a
 * flag its parser rejects fails here and not on a user's board.
 */

const SCRIPTS = fromFileUrl(new URL("../../templates/core/skills/task/scripts/", import.meta.url));

interface Board {
  /** issue → cascade-check exit (12 = closed). */
  closed?: Record<string, number>;
  /** the numbers the sweep reports DRIFTED. */
  drifted?: string[];
  /** the calls that fail, as logged: `move.sh 7 Done`, `move-batch.sh`, `sweep-closed.sh`. */
  fail?: string[];
}

async function backlog(backend: string, { closed = {}, drifted = [], fail = [] }: Board = {}) {
  const dir = await Deno.makeTempDir({ prefix: `specnaut-close-${backend}-` });
  // The installed layout: gitlab's _config.sh finds the project three levels up.
  const scripts = join(dir, ".specnaut", "scripts", "backlog");
  await Deno.mkdir(join(dir, "bin"), { recursive: true });
  await Deno.mkdir(scripts, { recursive: true });
  await Deno.copyFile(
    join(SCRIPTS, backend, "close-shipped.sh"),
    join(scripts, "close-shipped.sh"),
  );
  const failing = fail.map((f) => `"${f}"*) exit 1 ;;`).join(" ");
  // Each stub logs its call (to calls.log, in the scripts' directory) and fails on demand.
  const stub = (name: string, body: string) =>
    Deno.writeTextFile(
      join(scripts, name),
      `#!/usr/bin/env bash\necho "${name} $*" >> calls.log\ncase "${name} $*" in ${failing} esac\n${body}\n`,
    );
  const cases = Object.entries(closed).map(([n, c]) => `${n}) exit ${c} ;;`).join(" ");
  await stub("cascade-check.sh", `case $1 in ${cases} *) exit 3 ;; esac`);
  await stub("move.sh", "exit 0");
  await stub("move-batch.sh", "exit 0");
  if (backend === "gitlab") {
    for (const f of ["sweep-closed.sh", "_config.sh"]) {
      await Deno.copyFile(join(SCRIPTS, backend, f), join(scripts, f));
    }
    await Deno.writeTextFile(
      join(dir, ".specnaut", "backlog-config.yml"),
      "host: https://gitlab.example.com\nproject_id: acme/my-app\n",
    );
    const issues = drifted.map((d) =>
      `{"iid":${d},"labels":["Status::In progress"],"closed_at":"2999-01-01T00:00:00Z"}`
    );
    // The forge, reached through PATH. A failing sweep is a failing read, as on a real board.
    await Deno.writeTextFile(
      join(dir, "bin", "glab"),
      `#!/usr/bin/env bash\n${fail.includes("sweep-closed.sh") ? "exit 1" : ""}
case "$*" in *--closed*) echo '[${
        issues.join(",")
      }]' ;; *) echo '[{"iid":99,"labels":["Status::Ready"]}]' ;; esac\n`,
    );
    await Deno.chmod(join(dir, "bin", "glab"), 0o755);
  } else {
    const lines = drifted.map((d) => `echo "DRIFTED  ${d} In progress"`).join("\n");
    await stub(
      "sweep-closed.sh",
      `${lines}\necho "scanned 9, drifted ${drifted.length}, reopened 0"`,
    );
  }
  return {
    // By bare name from its own directory: the sibling lookup must not depend on the path's form.
    run: (...args: string[]) =>
      run("bash", ["close-shipped.sh", ...args], scripts, {
        PATH: `${join(dir, "bin")}${DELIMITER}${Deno.env.get("PATH")}`,
      }),
    calls: async () =>
      (await Deno.readTextFile(join(scripts, "calls.log")).catch(() => "")).trim().split("\n")
        .filter(Boolean),
    cleanup: () => Deno.remove(dir, { recursive: true }),
  };
}

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
