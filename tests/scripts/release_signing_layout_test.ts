import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parse } from "@std/yaml";

/**
 * The shape that keeps the macOS signing identity away from repository code
 * (cli#428).
 *
 * The Developer ID key reaches one job, `sign-macos`, through the
 * `macos-signing` environment and a keyless Google Cloud identity. That job
 * checks nothing out, runs no Deno and touches no repository path beyond the
 * binaries and the entitlements it was handed, so no code from the tagged
 * commit ever shares a runner with the key. The cloud side trusts only a token
 * naming that environment (infra/Pulumi.yaml), so the environment declaration
 * IS the boundary: a second job declaring it could read the key too.
 *
 * In a fork the job still runs — it passes the binaries through unsigned, with
 * a warning — because a skipped job would make `build` skip as well, and the
 * `if: always()` that would route around that also drops the security and ci
 * gates `build` waits on. "Fork" is keyed on the repository ID, which a rename
 * or a re-created repository does not inherit.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const WORKFLOWS = `${ROOT}.github/workflows`;
const CANONICAL = "github.repository_id == '1218483524'";
/** The only repository paths sign-macos may name: what `compile` handed it. */
const ALLOWED_PATHS = [/^dist\/(\$name|specnaut-\*)$/, /^packaging\/macos\/entitlements\.plist$/];

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
};
type Job = {
  needs?: string[] | string;
  if?: string;
  environment?: string | { name?: string };
  permissions?: Record<string, string> | string;
  env?: Record<string, string>;
  steps?: Step[];
};
type Workflow = { jobs: Record<string, Job> };

async function workflow(file = "release.yml"): Promise<Workflow> {
  return parse(await Deno.readTextFile(`${WORKFLOWS}/${file}`)) as Workflow;
}
const signSteps = async () => (await workflow()).jobs["sign-macos"].steps ?? [];
const fetchStep = async () =>
  (await signSteps()).find((s) => (s.run ?? "").includes("secretmanager.googleapis.com"));
const needs = (j: Job) => (Array.isArray(j.needs) ? j.needs : j.needs ? [j.needs] : []);
const envName = (j: Job) => typeof j.environment === "string" ? j.environment : j.environment?.name;

/** Repository-relative paths named in a text: anything under a top-level entry, or `dist/`. */
async function repoPathPattern(): Promise<RegExp> {
  const tops = ["dist"];
  for await (const e of Deno.readDir(ROOT)) if (!e.name.startsWith(".git")) tops.push(e.name);
  const alt = tops.map((t) => t.replaceAll(".", "\\.")).join("|");
  return new RegExp(`(?<![\\w$/.-])((?:${alt})/[^\\s"';|)]*)`, "g");
}

Deno.test("only release.yml's sign-macos job declares the macos-signing environment", async () => {
  const declaring: string[] = [];
  for await (const e of Deno.readDir(WORKFLOWS)) {
    if (!/\.ya?ml$/.test(e.name)) continue;
    for (const [id, j] of Object.entries((await workflow(e.name)).jobs ?? {})) {
      if (envName(j) === "macos-signing") declaring.push(`${e.name}:${id}`);
    }
  }
  assertEquals(declaring, ["release.yml:sign-macos"]);
});

Deno.test("sign-macos holds id-token: write and nothing else", async () => {
  assertEquals((await workflow()).jobs["sign-macos"].permissions, { "id-token": "write" });
});

Deno.test("sign-macos installs nothing from the repository and runs no Deno", async () => {
  for (const s of await signSteps()) {
    const uses = s.uses ?? "";
    assert(!uses.startsWith("./"), `a local action runs repository code: ${uses}`);
    assert(!/^(actions\/checkout|denoland\/setup-deno)@/.test(uses), `sign-macos uses ${uses}`);
    assert(!/\bdeno\b/.test(s.run ?? ""), `'${s.name}' runs deno`);
    // Tracing would print every expanded command, credential paths and all.
    assert(!/set -[a-z]*x|set -o xtrace/.test(s.run ?? ""), `'${s.name}' traces its commands`);
  }
});

Deno.test("sign-macos names no repository path beyond the binaries and the entitlements", async () => {
  const pattern = await repoPathPattern();
  for (const s of await signSteps()) {
    const text = `${s.run ?? ""}\n${JSON.stringify(s.with ?? {})}`;
    for (const [, path] of text.matchAll(pattern)) {
      assert(ALLOWED_PATHS.some((p) => p.test(path)), `'${s.name ?? s.uses}' names ${path}`);
    }
  }
});

Deno.test("no step anywhere in release.yml calls gcloud", async () => {
  const steps = Object.values((await workflow()).jobs).flatMap((j) => j.steps ?? []);
  for (const s of steps) assert(!/\bgcloud\b/.test(s.run ?? ""), `'${s.name}' calls gcloud`);
});

Deno.test("sign-macos signs only in the canonical repository and warns in a fork", async () => {
  const job = (await workflow()).jobs["sign-macos"];
  assertEquals(job.if, undefined, "a skipped sign-macos skips build too: branch inside the steps");
  const credentialed = (job.steps ?? []).filter((s) =>
    s.uses?.startsWith("google-github-actions/auth@") ||
    /secretmanager\.googleapis\.com|rcodesign (sign|notary-submit)/.test(s.run ?? "")
  );
  assertEquals(credentialed.length, 4, "the auth, fetch, sign and notarize steps");
  for (const s of credentialed) assertEquals(s.if, CANONICAL, `'${s.name ?? s.uses}' is not gated`);
  const fork = (job.steps ?? []).find((s) => s.if === CANONICAL.replace("==", "!="));
  assertStringIncludes(fork?.run ?? "", "::warning::", "a fork must be told it ships unsigned");
});

Deno.test("every canonical-repository test in release.yml is keyed on the repository ID", async () => {
  const text = await Deno.readTextFile(`${WORKFLOWS}/release.yml`);
  assert(!/github\.repository\s*[!=]=/.test(text), "a fork test keyed on the repository NAME");
  assertEquals((text.match(/github\.repository_id [!=]= '1218483524'/g) ?? []).length, 9);
});

Deno.test("the signing material is deleted after signing and on every outcome", async () => {
  const steps = await signSteps();
  const sign = steps.find((s) => /rcodesign sign/.test(s.run ?? ""))?.run ?? "";
  assert(
    /rm -f "\$RUNNER_TEMP\/signing\/macos-developer-id-p12"/.test(sign),
    "the key outlives signing",
  );
  const cleanup = steps.find((s) => /rm -rf "\$RUNNER_TEMP\/signing"/.test(s.run ?? ""));
  assertEquals(cleanup?.if, "always()", "the signing material must be deleted on every outcome");
});

Deno.test("sign-macos authenticates with a short-lived token and leaves no credential file", async () => {
  const auth = (await signSteps()).find((s) => s.uses?.startsWith("google-github-actions/auth@"));
  const w = Object.fromEntries(Object.entries(auth?.with ?? {}).map(([k, v]) => [k, String(v)]));
  assertEquals(w.token_format, "access_token");
  assertEquals(w.create_credentials_file, "false");
  assertEquals(w.export_environment_variables, "false");
  assertEquals(w.access_token_lifetime, "300s");
});

Deno.test("the secrets are read over REST into 0600 files, never a variable or argv", async () => {
  const run = (await fetchStep())?.run ?? "";
  assertStringIncludes(run, "umask 077");
  assertStringIncludes(run, '-H @"$dir/auth-header"', "the bearer header must come from a file");
  assertStringIncludes(run, `jq -j '.payload.data' "$dir/response" | base64 -d > "$dir/$name"`);
  assertStringIncludes(run, "(HTTP $status)", "a failure prints the status, nothing more");
  assert(!/Bearer \$|\$\(\s*base64|=\$\(jq/.test(run), "a credential lands in argv or a variable");
});

Deno.test("the jobs run compile, then sign-macos, then macos-smoke, then build", async () => {
  const { jobs } = await workflow();
  assertEquals(needs(jobs["sign-macos"]), ["compile"]);
  assert(needs(jobs["macos-smoke"]).includes("sign-macos"), "the smoke runs before signing");
  for (const gate of ["security-preflight", "ci-status", "sign-macos", "macos-smoke"]) {
    assert(needs(jobs.build).includes(gate), `build does not wait for ${gate}`);
  }
  for (const [id, j] of Object.entries(jobs)) {
    assert(!/always\(\)/.test(j.if ?? ""), `${id} runs whatever its needs concluded`);
  }
});

Deno.test("build attests what sign-macos uploaded, never the compiled set", async () => {
  const { jobs } = await workflow();
  const artifact = (job: string, action: string) =>
    (jobs[job].steps ?? []).find((s) => s.uses?.startsWith(`actions/${action}-artifact@`))?.with
      ?.name;
  assert(artifact("sign-macos", "upload"), "sign-macos uploads nothing");
  assertEquals(artifact("build", "download"), artifact("sign-macos", "upload"));
});
