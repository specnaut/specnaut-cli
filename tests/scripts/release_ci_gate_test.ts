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
 * moment as the release workflow. So four outcomes have to be told apart, and
 * only one of them blocks. These tests run the step's actual shell against a
 * stubbed `gh` for each: what this gate does when it CANNOT answer matters as
 * much as what it does when it can, and a gate that blocks on absence would
 * make an unverifiable repository unable to release at all.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

type Step = { name?: string; run?: string };
type Workflow = { jobs: Record<string, { needs?: string[]; steps?: Step[] }> };

async function workflow(): Promise<Workflow> {
  return parse(await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`)) as Workflow;
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
 * Run the gate with a fake `gh` that answers with `ghLine`, and a `sleep` that
 * does not. The deadline is rewritten to zero so the "still running" path is
 * reached on the first pass instead of in twenty-five minutes.
 */
async function runGate(ghLine: string): Promise<{ code: number; out: string; summary: string }> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-ci-gate-" });
  try {
    const bin = join(dir, "bin");
    await Deno.mkdir(bin);
    await Deno.writeTextFile(
      join(bin, "gh"),
      `#!/usr/bin/env bash\nprintf '%s' ${JSON.stringify(ghLine)}\n`,
    );
    // The real step sleeps 20s between polls. Nothing here should wait.
    await Deno.writeTextFile(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
    await Deno.chmod(join(bin, "gh"), 0o755);
    await Deno.chmod(join(bin, "sleep"), 0o755);

    const summary = join(dir, "summary.md");
    await Deno.writeTextFile(summary, "");

    const script = (await gateScript()).replace(
      /deadline=\$\(\( SECONDS \+ 25 \* 60 \)\)/,
      "deadline=$(( SECONDS ))",
    );
    assert(script.includes("deadline=$(( SECONDS ))"), "the deadline override did not apply");

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

Deno.test("release ci gate: a ci still running past the window warns and proceeds", async () => {
  const r = await runGate("in_progress -");
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, "::warning::");
  assertStringIncludes(r.out, "still in_progress");
});

Deno.test("release ci gate: every outcome is reported in the step summary", async () => {
  // A gate that proceeds on a warning has to leave the reason somewhere a
  // human reads. Two of the four outcomes above publish unverified.
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
