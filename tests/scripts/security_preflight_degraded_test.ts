import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

/**
 * #522 — the release security gate's degraded-mode warning was dead code.
 *
 * `fetch_count` recorded inaccessible queries by appending to a `missing_perms`
 * array, but every call site is a command substitution, so the function ran in
 * a subshell and the mutation died with it. The parent's array was always
 * empty and the `::warning::` had never printed.
 *
 * The `private_advisories` query returns non-numeric on every run under
 * `GITHUB_TOKEN` — the step's own comment says so — which means the step had
 * been permanently in degraded mode and permanently silent about it. The cost
 * is not a missing log line: a revoked scope on any of the seven queries reads
 * as "0 open alerts", and the gate then passes on an empty signal it believes
 * is a clean one.
 *
 * These tests run the step's actual shell against a stubbed `gh`, because the
 * defect was invisible to reading — the code looked correct and the array was
 * right there.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

type Step = { name?: string; run?: string };
type Workflow = { jobs: Record<string, { steps?: Step[] }> };

async function alertStepScript(): Promise<string> {
  const wf = parse(
    await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`),
  ) as Workflow;
  const step = Object.values(wf.jobs)
    .flatMap((j) => j.steps ?? [])
    .find((s) => s.name === "Query open security alerts");
  assert(step?.run, "no 'Query open security alerts' step with a run block");
  return step.run;
}

/**
 * Run the step's shell with a fake `gh` on PATH.
 *
 * @param failingUrlFragment when a queried URL contains it, `gh` emits GitHub's
 *   4xx error JSON on STDOUT — the exact shape that makes `fetch_count` take
 *   its failure branch. Pass null for a fully healthy run.
 */
async function runStep(
  failingUrlFragment: string | null,
  /** When a queried URL contains this, `gh` answers `1` instead of `0` — a
   *  readable source with a finding, which is what makes the gate block. */
  nonZeroUrlFragment: string | null = null,
): Promise<{ code: number; out: string; summary: string }> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-522-" });
  try {
    const bin = join(dir, "bin");
    await Deno.mkdir(bin);
    // No spaces: an unquoted space in a `case` pattern is a bash syntax error,
    // which silently makes the stub non-executable — every query then "fails"
    // and the degraded warning fires for all seven, passing the wrong test for
    // the wrong reason.
    const fail = failingUrlFragment ?? "__no_such_url__";
    const hit = nonZeroUrlFragment ?? "__no_such_finding__";
    const stub = [
      "#!/usr/bin/env bash",
      'for a in "$@"; do',
      `  case "$a" in *${fail}*)`,
      `    echo '{"message":"Resource not accessible by integration","status":"403"}'`,
      "    exit 1;;",
      "  esac",
      "done",
      'for a in "$@"; do',
      `  case "$a" in *${hit}*) echo 1; exit 0;; esac`,
      "done",
      "echo 0",
      "",
    ].join("\n");
    await Deno.writeTextFile(join(bin, "gh"), stub);
    await Deno.chmod(join(bin, "gh"), 0o755);

    const script = join(dir, "step.sh");
    await Deno.writeTextFile(script, await alertStepScript());

    const { code, stdout, stderr } = await new Deno.Command("bash", {
      args: [script],
      cwd: dir,
      env: {
        PATH: `${bin}:${Deno.env.get("PATH")}`,
        RUNNER_TEMP: dir,
        GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
        REPO: "specnaut/specnaut-cli",
        GH_TOKEN: "stub",
      },
      clearEnv: true,
      stdout: "piped",
      stderr: "piped",
    }).output();
    let summary = "";
    try {
      summary = await Deno.readTextFile(join(dir, "summary.md"));
    } catch { /* the step failed before writing one */ }
    return {
      code,
      out: new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr),
      summary,
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("an inaccessible query is named in a degraded-mode warning", async () => {
  const { code, out } = await runStep("code-scanning");
  assertStringIncludes(out, "::warning::Security preflight could not read:");
  assertStringIncludes(out, "code_scanning/critical");
  // ...and ONLY that source. A warning naming everything means the stub never
  // ran and every query fell through — which is how this test first passed
  // while proving nothing.
  assert(
    !out.includes("secret_scanning"),
    `only the inaccessible query should be named; got:\n${out}`,
  );
  // Degraded mode is a warning, never a block — the gate's behaviour is unchanged.
  assert(code === 0, `degraded mode must not fail the release, got exit ${code}:\n${out}`);
});

Deno.test("the warning discriminates — a healthy run stays silent", async () => {
  const { code, out } = await runStep(null);
  assert(
    !out.includes("could not read:"),
    `every query succeeded; the warning must not fire:\n${out}`,
  );
  assert(code === 0, `a clean run must pass, got exit ${code}:\n${out}`);
});

Deno.test("sources the local preflight gates do not warn when this token cannot read them", async () => {
  // GITHUB_TOKEN cannot read secret scanning or Dependabot on any run, so a
  // warning about them printed on every release and taught everyone to skip
  // it (#653). They are gated by `.specnaut/release/preflight.sh` instead.
  for (const source of ["secret-scanning", "dependabot"]) {
    const { code, out, summary } = await runStep(source);
    assert(!out.includes("could not read:"), `${source} must not warn:\n${out}`);
    assertStringIncludes(summary, "not read here — gated by `preflight.sh`");
    assertEquals(summary.includes("were NOT checked"), false, summary);
    assertEquals(code, 0, out);
  }
});

Deno.test("private advisories are not queried here, and say where they are gated", async () => {
  // A caller without the PAT-only scope can be answered `[]`, which reads as
  // clean; the local preflight checks admin rights before trusting a count.
  const script = await alertStepScript();
  assertEquals(script.includes("security-advisories"), false, "the step must not query advisories");
  const { summary } = await runStep(null);
  assertStringIncludes(
    summary,
    "| Pending private advisories | not read here — gated by `preflight.sh` |",
  );
});

Deno.test("the secret-scanning query never asks for the secret itself", async () => {
  assertStringIncludes(
    await alertStepScript(),
    "secret-scanning/alerts?state=open&hide_secret=true",
  );
});

Deno.test("one failing URL is named once per label, not repeated", async () => {
  // The code-scanning counts share a URL, so one permission gap trips
  // fetch_count once per severity. This pins the de-duplication.
  const { out } = await runStep("code-scanning");
  assertStringIncludes(out, "::warning::");
  const warning = out.split("\n").find((l) => l.includes("could not read:"))!;
  const labels = warning.split("could not read:")[1].split(".")[0].trim().split(/\s+/);
  assert(
    new Set(labels).size === labels.length,
    `labels must be de-duplicated, got: ${labels.join(" ")}`,
  );
});

Deno.test("a blocking gate still says what it could not read", async () => {
  // The run where this matters most, and the one that never printed it: the
  // gate hard-fails, and the reader needs to know the decision was taken on
  // partial information. The read-back used to sit BELOW the `exit 1` (#527).
  const { code, out } = await runStep("code-scanning", "secret-scanning");

  assertEquals(code, 1, `an open secret-scanning alert must block:\n${out}`);
  assertStringIncludes(out, "::error::Security preflight blocked the release");
  assertStringIncludes(out, "::warning::Security preflight could not read:");
  assertStringIncludes(out, "code_scanning/critical");
});

Deno.test("an unreadable source is reported as unreadable, never as zero", async () => {
  // `0` and "could not ask" were the same cell for the entire life of this
  // gate, which is how it passed on three sources it had never obtained (#527).
  const { summary } = await runStep("code-scanning");

  assertStringIncludes(summary, "| Code scanning — critical | unreadable |");
  // ...while a source that WAS read still shows its number.
  assertStringIncludes(summary, "| Secret scanning | 0 |");
  assertStringIncludes(summary, "were NOT checked");
});

Deno.test("a fully readable run reports numbers and no caveat", async () => {
  const { summary } = await runStep(null);
  assertEquals(summary.includes("unreadable"), false, summary);
  assertEquals(summary.includes("were NOT checked"), false, summary);
});
