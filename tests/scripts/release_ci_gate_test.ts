import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

/**
 * The tag is what publishes, and nothing in `release.yml` used to ask whether
 * the commit it points at is green.
 *
 * `ci.yml` runs the suite on three OSes on every push to `main`; the release
 * workflow runs none of it. So a tag pushed over a red `main` compiled,
 * checksummed and published a Release, entirely green, with a known-failing
 * commit inside. The only thing in the way was `preflight.sh` — a script an
 * operator runs locally, can skip, and which this workflow cannot consult.
 *
 * The gate is a wait, not a read, because `ci` on that SHA starts at the same
 * moment as the release workflow. So five outcomes have to be told apart; three
 * of them block. These tests run the step's actual shell against a
 * stubbed `gh` for each: what this gate does when it CANNOT answer matters as
 * much as what it does when it can, and a gate that blocks on absence would
 * make an unverifiable repository unable to release at all.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

type Step = { name?: string; run?: string };
type Job = { needs?: string | string[]; steps?: Step[]; "timeout-minutes"?: number };
type Workflow = { jobs: Record<string, Job> };

async function workflow(file = "release.yml"): Promise<Workflow> {
  return parse(await Deno.readTextFile(`${ROOT}.github/workflows/${file}`)) as Workflow;
}

const SCRIPT = "scripts/release/require-ci-green.sh";

/** The gate's shell, read from the file the workflow step runs. */
async function gateScript(): Promise<string> {
  return await Deno.readTextFile(`${ROOT}${SCRIPT}`);
}

Deno.test("release ci gate: the workflow step runs the script these tests exercise", async () => {
  const step = Object.values((await workflow()).jobs)
    .flatMap((j) => j.steps ?? [])
    .find((s) => s.name === "Require ci green on the tagged commit");
  assertEquals(step?.run?.trim(), `bash ${SCRIPT}`);
});

/**
 * Run the gate with a fake `gh` that answers its n-th call with `answers[n]` (the
 * last one repeats; `FAIL` makes the call exit 1), and a `sleep` that does not.
 * Both clock checks are rewritten to count polls, so the gate polls exactly
 * `polls` times, deterministically, instead of for WAIT_MINUTES; the wait for a
 * run to appear ends after `appearPolls` (default: the same).
 */
async function runGate(
  answers: string | string[],
  polls = 1,
  appearPolls = polls,
): Promise<{ code: number; out: string; summary: string; calls: number }> {
  const lines = typeof answers === "string" ? [answers] : answers;
  const dir = await Deno.makeTempDir({ prefix: "specnaut-ci-gate-" });
  try {
    const bin = join(dir, "bin");
    await Deno.mkdir(bin);
    const cases = lines.map((l, i) =>
      `  ${i === lines.length - 1 ? "*" : i}) ${
        l === "FAIL" ? "exit 1" : `printf '%s' ${JSON.stringify(l)}`
      } ;;`
    );
    await Deno.writeTextFile(
      join(bin, "gh"),
      `#!/usr/bin/env bash
n=$(cat "${dir}/n" 2>/dev/null || echo 0)
echo $((n + 1)) > "${dir}/n"
case $n in
${cases.join("\n")}
esac
`,
    );
    // The real step sleeps 20s between polls. Nothing here should wait.
    await Deno.writeTextFile(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
    await Deno.chmod(join(bin, "gh"), 0o755);
    await Deno.chmod(join(bin, "sleep"), 0o755);

    const summary = join(dir, "summary.md");
    await Deno.writeTextFile(summary, "");

    const gate = await gateScript();
    const script = gate
      .replace('last_empty=""', 'last_empty=""\npolled=0')
      .replace('[ "$SECONDS" -ge "$deadline" ]', `[ "$((++polled))" -ge ${polls} ]`)
      .replace('[ "$SECONDS" -ge "$appear_deadline" ]', `[ "$polled" -ge ${appearPolls} ]`);
    assertEquals(
      script.split("polled").length - gate.split("polled").length,
      3,
      "the counter and both clock checks must be rewritten",
    );

    const { code, stdout, stderr } = await new Deno.Command("bash", {
      args: ["-c", script],
      env: {
        PATH: `${bin}:${Deno.env.get("PATH")}`,
        GH_TOKEN: "stub",
        REPO: "specnaut/specnaut-cli",
        SHA: "0123456789abcdef0123456789abcdef01234567",
        GITHUB_STEP_SUMMARY: summary,
      },
      clearEnv: true,
      stdout: "piped",
      stderr: "piped",
    }).output();

    return {
      code,
      out: new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr),
      summary: await Deno.readTextFile(summary),
      calls: Number(await Deno.readTextFile(join(dir, "n"))),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("release ci gate: a green ci lets the release through", async () => {
  const r = await runGate("completed success");
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, "is green on");
  assert(!r.out.includes("::error::"), r.out);
});

Deno.test("release ci gate: a failed ci blocks the release", async () => {
  // The one outcome that must stop the pipeline. This is the whole point:
  // v4.2.2's first attempt had a red `main`, and the tag pipeline would have
  // published over it without a word.
  const r = await runGate("completed failure");
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "::error::");
  assertStringIncludes(r.out, "concluded failure");
  // The recovery has to be in the message: the tag survives a failed workflow,
  // so nobody should be deleting and re-tagging to get out of this.
  assertStringIncludes(r.out, "re-run this workflow");
});

Deno.test("release ci gate: a cancelled ci blocks too", async () => {
  const r = await runGate("completed cancelled");
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "concluded cancelled");
});

Deno.test("release ci gate: no ci run at all warns and proceeds", async () => {
  // A repository or ref where `ci` does not run must still be able to release.
  // Blocking on absence trades a visible failure for an unreleasable project.
  const r = await runGate("");
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, "::warning::");
  assertStringIncludes(r.out, "No ci.yml run found");
  assert(!r.out.includes("::error::"), r.out);
});

Deno.test("release ci gate: a gh error at the deadline keeps the last answer and blocks", async () => {
  // A failed call is not "no run": a run seen in progress stays in progress.
  const r = await runGate(["in_progress -", "FAIL"], 2);
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "still in_progress");
});

Deno.test("release ci gate: no run appearing in the short window proceeds before the long one", async () => {
  // A ref without ci is not held for the whole wait: the appear exit is taken.
  const r = await runGate("", 3, 1);
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, "No ci.yml run found");
  assertEquals(r.calls, 1, "the gate must stop polling once the appear window ends");
});

Deno.test("release ci gate: failed calls after an empty answer are not 'no run'", async () => {
  // An empty answer, then an outage through the appear window and the deadline.
  const r = await runGate(["", "FAIL"], 3, 2);
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "Could not read");
});

Deno.test("release ci gate: runs that could never be read block the release", async () => {
  const r = await runGate("FAIL");
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "Could not read");
});

Deno.test("release ci gate: a ci still running past the window blocks the release", async () => {
  // The window covers ci's longest legitimate run, so a run still going is stuck,
  // and the commit it was verifying is not verified.
  const r = await runGate("in_progress -");
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "::error::");
  assertStringIncludes(r.out, "still in_progress");
});

Deno.test("release ci gate: the wait covers ci's longest run, and its job outlives the wait", async () => {
  // cross-smoke needs lint-test, so ci's longest legitimate run is the two
  // timeouts end to end. Raising either without the window lets a slow, green
  // ci reach the gate's verdict as "still running", which now blocks.
  const wait = Number((await gateScript()).match(/^WAIT_MINUTES=(\d+)$/m)?.[1]);
  const ci = (await workflow("ci.yml")).jobs;
  const lint = ci["lint-test"]["timeout-minutes"];
  const smoke = ci["cross-smoke"]["timeout-minutes"];
  assert(lint && smoke, `ci.yml must cap lint-test and cross-smoke, got ${lint} and ${smoke}`);
  assertEquals(ci["cross-smoke"].needs, "lint-test");
  assert(
    wait >= lint + smoke + 15,
    `the wait (${wait}) must cover ${lint} + ${smoke} and a margin`,
  );
  const job = (await workflow()).jobs["ci-status"]["timeout-minutes"] ?? 0;
  assert(job > wait, `ci-status's timeout (${job}) must outlive the wait (${wait})`);
});

Deno.test("release ci gate: every outcome is reported in the step summary", async () => {
  // A gate that blocks, or proceeds on a warning, has to leave the reason
  // somewhere a human reads.
  for (const line of ["completed success", "in_progress -", ""]) {
    const r = await runGate(line);
    assertStringIncludes(r.summary, "CI status on the tagged commit");
    assertStringIncludes(r.summary, "ci run status");
  }
});

Deno.test("release ci gate: build cannot start without it", async () => {
  // The job existing is not the gate; `build` needing it is.
  const wf = await workflow();
  assert(wf.jobs["ci-status"], "the ci-status job is gone");
  assertEquals(
    (wf.jobs.build.needs ?? []).includes("ci-status"),
    true,
    `build must need ci-status, got: ${JSON.stringify(wf.jobs.build.needs)}`,
  );
});
