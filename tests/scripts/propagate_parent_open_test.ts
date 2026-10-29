import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * Two shipped components disagreed about whether a state was valid, and one of
 * them created it on purpose.
 *
 * `propagate-parent-status.sh` advanced a parent to **Done** when its last open
 * child reached Done — it calls `move.sh` and closes nothing. So the parent's
 * card read Done while the parent issue was still open, which is precisely what
 * `sweep-closed.sh` names in its own header: `REOPENED — open, but sitting in
 * Done`, one of the three drifts the detector exists to report.
 *
 * The window was structural. The promotion fires at the CHILD's move, which
 * necessarily precedes any close of the parent, and nothing obliges a caller to
 * close it. `phases/merge-close.md` closes the epic itself under the cascade
 * gate and never invokes this hook, so the only path the promotion decided
 * anything on was the one where nobody closes the parent.
 *
 * `Done` means the work is finished. "Every child is Done" is not that — the
 * parent may carry its own residual work, and `cascade-check.sh` exists to gate
 * that judgement, which this hook deliberately does not consult. `In review` is
 * the column the evidence supports. A parent already closed still goes to Done:
 * there the card is only lagging a fact already established, and that case is
 * what keeps this fix from being "never promote".
 */

const SCRIPTS = fromFileUrl(
  new URL("../../templates/core/skills/task/scripts/", import.meta.url),
);

type Result = { code: number; out: string; err: string };

/**
 * Run the hook with a stubbed `gh` and a stubbed `move.sh`, in the INSTALLED
 * layout — `_config.sh` resolves the project root three levels up and then
 * needs a real `backlog-config.yml`.
 *
 * `move.sh` is stubbed rather than mocked away: the assertion is which column
 * the hook ASKS for, and a stub that records its argv is the only way to see
 * that without a live board.
 */
async function runHook(
  parentState: "OPEN" | "CLOSED",
  parentStatus: string,
  childStatuses: string[],
): Promise<Result & { movedTo: string | null }> {
  const dir = await Deno.makeTempDir({ prefix: "propagate-" });
  try {
    const bin = join(dir, "bin");
    await Deno.mkdir(bin);

    const payload = JSON.stringify({
      total: childStatuses.length,
      state: parentState,
      statuses: childStatuses,
    });
    // The hook makes FOUR distinct `gh` calls, and a stub has to answer each
    // as itself: the child's parent number, the project node id, the parent's
    // own project Status, and the children plus the parent's issue state.
    //
    // The first stub keyed on `graphql` alone and answered all three GraphQL
    // calls with the children payload, so the parent NUMBER came back as a
    // status string and the run died before the promotion — reporting the fix
    // as broken. A stub that cannot tell the calls apart is a probe that
    // cannot tell the outcomes apart. Each query is keyed on a field only it
    // names.
    await Deno.writeTextFile(
      join(bin, "gh"),
      `#!/usr/bin/env bash
case "$*" in
  *"project view"*) printf '%s' 'PVT_stubprojectnodeid'; exit 0 ;;
  *subIssues*)      printf '%s' ${JSON.stringify(payload)}; exit 0 ;;
  *parent*)         printf '%s' '7'; exit 0 ;;
  *graphql*)        printf '%s' ${JSON.stringify(parentStatus)}; exit 0 ;;
  *)                exit 0 ;;
esac
`,
    );
    await Deno.chmod(join(bin, "gh"), 0o755);

    const scripts = join(dir, ".specnaut", "scripts", "backlog");
    await Deno.mkdir(scripts, { recursive: true });
    for await (const e of Deno.readDir(join(SCRIPTS, "github"))) {
      if (e.isFile) await Deno.copyFile(join(SCRIPTS, "github", e.name), join(scripts, e.name));
    }
    const moveLog = join(dir, "move.log");
    await Deno.writeTextFile(
      join(scripts, "move.sh"),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$2" >> ${JSON.stringify(moveLog)}\nexit 0\n`,
    );
    await Deno.chmod(join(scripts, "move.sh"), 0o755);
    await Deno.writeTextFile(
      join(dir, ".specnaut", "backlog-config.yml"),
      "repo: acme/widgets\nproject_number: 1\n",
    );

    const { code, stdout, stderr } = await new Deno.Command("bash", {
      args: [join(scripts, "propagate-parent-status.sh"), "7", "Done"],
      env: { PATH: `${bin}:${Deno.env.get("PATH")}`, HOME: dir },
      clearEnv: true,
      stdout: "piped",
      stderr: "piped",
    }).output();

    let movedTo: string | null = null;
    try {
      movedTo = (await Deno.readTextFile(moveLog)).trim().split("\n").pop() ?? null;
    } catch {
      movedTo = null;
    }

    return {
      code,
      out: new TextDecoder().decode(stdout),
      err: new TextDecoder().decode(stderr),
      movedTo,
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("propagate: an OPEN parent is not moved to Done", async () => {
  // The defect. Done here is a verdict nobody established, and it is the exact
  // state `sweep-closed.sh` reports as REOPENED.
  const r = await runHook("OPEN", "In progress", ["Done", "Done"]);
  assert(
    r.movedTo !== "Done",
    `an open parent was moved to Done — the state the sweep reports as drift:\n${r.out}${r.err}`,
  );
  assertEquals(r.movedTo, "In review");
  assertStringIncludes(r.out, "the issue is still open");
});

Deno.test("propagate: a CLOSED parent still goes to Done", async () => {
  // The half that keeps this from being "never promote". Here the card is
  // lagging a fact already established, which is the hook's useful case.
  const r = await runHook("CLOSED", "In progress", ["Done", "Done"]);
  assertEquals(r.movedTo, "Done", `${r.out}${r.err}`);
  assertStringIncludes(r.out, "the issue is closed");
});

Deno.test("propagate: an open child still blocks any promotion", async () => {
  // Unchanged, and asserted so the fix cannot buy its correctness by
  // promoting less often for the wrong reason.
  const r = await runHook("OPEN", "In progress", ["Done", "In progress"]);
  assertEquals(r.movedTo, null, `a parent with an open child was promoted:\n${r.out}`);
});

Deno.test("propagate: a parent already in the target column is left alone", async () => {
  // Printing a promotion line for a transition that did not happen is a small
  // lie of the same family.
  const r = await runHook("OPEN", "In review", ["Done"]);
  assertEquals(r.movedTo, null, `a redundant move was issued:\n${r.out}`);
  assert(!r.out.includes("promoted parent"), `a promotion was announced anyway:\n${r.out}`);
});

Deno.test("propagate: it never closes an issue", async () => {
  // Out of scope for the ticket and asserted anyway. Closing belongs to
  // `merge-close.md` under the cascade gate; a hook that started closing
  // issues would satisfy every assertion above.
  for (const backend of ["github", "local"] as const) {
    const src = await Deno.readTextFile(join(SCRIPTS, backend, "propagate-parent-status.sh"));
    assert(
      !/gh issue close|glab issue close/.test(src),
      `${backend}: the propagation hook closes issues`,
    );
  }
});

Deno.test("propagate: the local backend is left unchanged, with the reason recorded", async () => {
  // It keeps ONE field — `status:` in the task file — so "the card says Done
  // while the item is open" is not a state it can represent. Copying the
  // two-field guard there would guard against nothing, and a silent skip would
  // read as an oversight on the next sweep of this family.
  const src = await Deno.readTextFile(join(SCRIPTS, "local", "propagate-parent-status.sh"));
  assertStringIncludes(src, "Unconditional Done is correct HERE");
  assert(
    !/PARENT_ISSUE_STATE/.test(src),
    "the local twin acquired a guard for a state it cannot represent",
  );
});

Deno.test("propagate: there are exactly two implementations", async () => {
  // The ticket said to confirm at pickup rather than trust it. If a gitlab or
  // cloud twin appears, this fix has a new surface and this test says so.
  const found: string[] = [];
  for await (const e of Deno.readDir(SCRIPTS)) {
    if (!e.isDirectory) continue;
    try {
      await Deno.stat(join(SCRIPTS, e.name, "propagate-parent-status.sh"));
      found.push(e.name);
    } catch { /* backend has no propagation hook */ }
  }
  assertEquals(
    found.sort(),
    ["github", "local"],
    "a propagation implementation appeared or vanished — re-check the fix's surface",
  );
});
