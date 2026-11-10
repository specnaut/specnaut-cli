import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parse } from "@std/yaml";

/**
 * infra/Pulumi.yaml, the cloud side of macOS release signing (cli#428), and
 * its agreement with release.yml.
 *
 * The provider's attribute condition is the whole trust decision: whoever
 * satisfies it reads the Developer ID key. Each clause is pinned here, so
 * dropping one — the maintainer as actor, the environment, the tag ref — is a
 * red test rather than a quiet widening. The workflow's provider path, project
 * and service account must name exactly what this file creates, with a literal
 * project number: a placeholder or an expression is a release that cannot
 * authenticate, found out only on a tag.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

type Resource = {
  type: string;
  properties?: Record<string, unknown>;
  options?: Record<string, unknown>;
};
type Stack = { variables: Record<string, string>; resources: Record<string, Resource> };

const stack = async () => parse(await Deno.readTextFile(`${ROOT}infra/Pulumi.yaml`)) as Stack;
const signEnv = async () =>
  (parse(await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`)) as {
    jobs: Record<string, { env?: Record<string, string>; steps?: { run?: string }[] }>;
  }).jobs["sign-macos"];

const CLAUSES = [
  "assertion.repository_id == '${githubRepositoryId}'",
  "assertion.repository_owner_id == '${githubOwnerId}'",
  "assertion.repository == 'specnaut/specnaut-cli'",
  "assertion.event_name == 'push'",
  "assertion.ref_type == 'tag'",
  "assertion.workflow_ref.startsWith('specnaut/specnaut-cli/.github/workflows/release.yml@refs/tags/v')",
  "assertion.environment == 'macos-signing'",
  "assertion.runner_environment == 'github-hosted'",
  "assertion.actor_id == '${githubMaintainerId}'",
];

Deno.test("the provider trusts exactly the release tag push, by the maintainer, by id", async () => {
  const { variables, resources } = await stack();
  const condition = String(resources.provider.properties?.attributeCondition);
  assertEquals(condition.split(" && "), CLAUSES, "the attribute condition changed");
  assertEquals(
    [variables.githubRepositoryId, variables.githubOwnerId, variables.githubMaintainerId],
    ["1218483524", "294480954", "6215184"],
  );
  const member = String(resources.signerWorkloadIdentityUser.properties?.member);
  assert(member.endsWith("/attribute.repository_id/${githubRepositoryId}"), member);
});

Deno.test("every resource uses the pinned gcp provider; the project itself is not managed", async () => {
  const { resources } = await stack();
  assertMatch(String(resources.gcp.options?.version), /^\d+\.\d+\.\d+$/);
  for (const [id, r] of Object.entries(resources)) {
    if (id === "gcp") continue;
    assertEquals(r.options?.provider, "${gcp}", `${id} runs on an unpinned default provider`);
    assert(
      !/projects:(Project|Service)$|organizations:Project$/.test(r.type),
      `${id} owns ${r.type}`,
    );
  }
});

Deno.test("the secrets and the audit config this stack owns are protected", async () => {
  const { resources } = await stack();
  for (const [id, r] of Object.entries(resources)) {
    if (/secretmanager:Secret$|projects:IAMAuditConfig$/.test(r.type)) {
      assertEquals(r.options?.protect, true, `${id} can be destroyed by a stray pulumi destroy`);
    }
  }
  assertStringIncludes(
    await Deno.readTextFile(`${ROOT}infra/Pulumi.yaml`),
    "OWNS the project's Secret",
  );
});

Deno.test("the workflow's cloud coordinates are the ones this stack creates", async () => {
  const { resources } = await stack();
  const env = (await signEnv()).env ?? {};
  const m = String(env.GCP_WORKLOAD_IDENTITY_PROVIDER).match(
    /^projects\/(\d{11})\/locations\/global\/workloadIdentityPools\/([a-z0-9-]+)\/providers\/([a-z0-9-]+)$/,
  );
  assert(m, `not a literal provider path: ${env.GCP_WORKLOAD_IDENTITY_PROVIDER}`);
  assertEquals(m[2], resources.pool.properties?.workloadIdentityPoolId);
  assertEquals(m[3], resources.provider.properties?.workloadIdentityPoolProviderId);
  assertEquals(env.GCP_PROJECT, resources.gcp.properties?.project);
  const sa = `${resources.signer.properties?.accountId}@${env.GCP_PROJECT}.iam.gserviceaccount.com`;
  assertEquals(env.GCP_SERVICE_ACCOUNT, sa);
});

Deno.test("every secret this stack creates is the one the workflow reads", async () => {
  const { resources } = await stack();
  const ids = Object.values(resources)
    .filter((r) => r.type === "gcp:secretmanager:Secret")
    .map((r) => String(r.properties?.secretId));
  assertEquals(ids.length, 3);
  const fetch = ((await signEnv()).steps ?? []).find((s) =>
    /secretmanager\.googleapis/.test(s.run ?? "")
  );
  const loop = fetch?.run?.match(/for name in ([^;]+);/)?.[1].trim().split(/\s+/);
  assertEquals(loop, ids, "the workflow reads a different set of secrets");
});
