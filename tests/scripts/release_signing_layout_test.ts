import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parse } from "@std/yaml";

/**
 * The shape that keeps the macOS signing identity away from repository code
 * (cli#428).
 *
 * The Developer ID key reaches one job, `sign-macos`, through the
 * `macos-signing` environment and a keyless Google Cloud identity. That job
 * checks nothing out and runs no Deno, so no code from the tagged commit ever
 * shares a runner with the key; the job that runs that code (`compile`) and the
 * job that can write the release (`build`) never hold it. The cloud side only
 * trusts a token naming that environment (infra/Pulumi.yaml), so the
 * environment declaration IS the boundary: a second job declaring it could
 * read the key too.
 *
 * In a fork the job still runs — it passes the binaries through unsigned, with
 * a warning — because a skipped job would make `build` skip as well, and the
 * `if: always()` that would route around that also drops the security and ci
 * gates `build` waits on.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const WORKFLOWS = `${ROOT}.github/workflows`;
const CANONICAL = "github.repository == 'specnaut/specnaut-cli'";

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

function envName(j: Job): string | undefined {
  return typeof j.environment === "string" ? j.environment : j.environment?.name;
}

const needs = (j: Job) => (Array.isArray(j.needs) ? j.needs : j.needs ? [j.needs] : []);

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

Deno.test("sign-macos runs no repository code", async () => {
  const steps = (await workflow()).jobs["sign-macos"].steps ?? [];
  for (const s of steps) {
    const uses = s.uses ?? "";
    assert(!uses.startsWith("./"), `a local action runs repository code: ${uses}`);
    assert(!uses.startsWith("actions/checkout@"), "sign-macos checks the repository out");
    assert(!uses.startsWith("denoland/setup-deno@"), "sign-macos installs Deno");
    const run = s.run ?? "";
    assert(!/\bdeno\b/.test(run), `'${s.name}' runs deno`);
    assert(
      !/\b(bash|sh|source|\.) +(\.\/)?(scripts|src|hooks)\//.test(run),
      `'${s.name}' runs a repository script`,
    );
    // Tracing would print every expanded command, credential paths and all.
    assert(!/set -[a-z]*x|set -o xtrace/.test(run), `'${s.name}' traces its commands`);
  }
});

Deno.test("sign-macos signs only in the canonical repository and warns in a fork", async () => {
  const job = (await workflow()).jobs["sign-macos"];
  assertEquals(job.if, undefined, "a skipped sign-macos skips build too: branch inside the steps");
  const steps = job.steps ?? [];
  const credentialed = steps.filter((s) =>
    s.uses?.startsWith("google-github-actions/auth@") ||
    /gcloud|rcodesign (sign|notary-submit)/.test(s.run ?? "")
  );
  assert(credentialed.length >= 3, "the auth, fetch, sign and notarize steps were not found");
  for (const s of credentialed) assertEquals(s.if, CANONICAL, `'${s.name ?? s.uses}' is not gated`);
  const fork = steps.find((s) => s.if === CANONICAL.replace("==", "!="));
  assertStringIncludes(
    fork?.run ?? "",
    "::warning::",
    "a fork must be told its binaries are unsigned",
  );
  const cleanup = steps.find((s) => /rm -rf "\$RUNNER_TEMP\/signing"/.test(s.run ?? ""));
  assertEquals(cleanup?.if, "always()", "the signing material must be deleted on every outcome");
});

Deno.test("sign-macos authenticates with a short-lived token and leaves no credential file", async () => {
  const steps = (await workflow()).jobs["sign-macos"].steps ?? [];
  const auth = steps.find((s) => s.uses?.startsWith("google-github-actions/auth@"));
  const w = Object.fromEntries(Object.entries(auth?.with ?? {}).map(([k, v]) => [k, String(v)]));
  assertEquals(w.token_format, "access_token");
  assertEquals(w.create_credentials_file, "false");
  assertEquals(w.export_environment_variables, "false");
  assertEquals(w.access_token_lifetime, "300s");
  const fetch = steps.find((s) => /gcloud/.test(s.run ?? ""))?.run ?? "";
  assertStringIncludes(fetch, "umask 077");
  assertStringIncludes(fetch, "--out-file");
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
  // build attests what sign-macos uploaded, never the compiled set.
  const upload = (jobs["sign-macos"].steps ?? []).find((s) =>
    s.uses?.startsWith("actions/upload-artifact@")
  );
  const download = (jobs.build.steps ?? []).find((s) =>
    s.uses?.startsWith("actions/download-artifact@")
  );
  assert(upload?.with?.name, "sign-macos uploads nothing");
  assertEquals(download?.with?.name, upload.with.name, "build does not attest the signed set");
});

Deno.test("the workflow's cloud coordinates are the ones infra/Pulumi.yaml creates", async () => {
  const env = (await workflow()).jobs["sign-macos"].env ?? {};
  const infra = await Deno.readTextFile(`${ROOT}infra/Pulumi.yaml`);
  const value = (key: string) => infra.match(new RegExp(`\\b${key}: "?([a-z0-9-]+)"?`))?.[1];
  // A literal project number: a placeholder or an expression is a release that
  // cannot authenticate, found out only on a tag.
  const m = String(env.GCP_WORKLOAD_IDENTITY_PROVIDER).match(
    /^projects\/(\d{11})\/locations\/global\/workloadIdentityPools\/([a-z0-9-]+)\/providers\/([a-z0-9-]+)$/,
  );
  assert(m, `not a literal provider path: ${env.GCP_WORKLOAD_IDENTITY_PROVIDER}`);
  assertEquals(m[2], value("workloadIdentityPoolId"), "the pool id differs from infra/");
  assertEquals(
    m[3],
    value("workloadIdentityPoolProviderId"),
    "the provider id differs from infra/",
  );
  assertEquals(env.GCP_PROJECT, value("gcp:project"), "the project differs from infra/");
  assertEquals(
    env.GCP_SERVICE_ACCOUNT,
    `${value("accountId")}@${env.GCP_PROJECT}.iam.gserviceaccount.com`,
    "the service account differs from infra/",
  );
  for (const id of [...infra.matchAll(/\bsecretId: "?([a-z0-9-]+)"?/g)].map((x) => x[1])) {
    const fetch = (await workflow()).jobs["sign-macos"].steps?.find((s) =>
      /gcloud/.test(s.run ?? "")
    );
    assertMatch(
      fetch?.run ?? "",
      new RegExp(`\\b${id}\\b`),
      `secret ${id} is created but never read`,
    );
  }
});
