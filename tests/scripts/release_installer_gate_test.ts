import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parse } from "@std/yaml";
import {
  ATTESTED_ASSETS,
  INSTALLER_ASSET_NAME,
  verifyReleaseDir,
} from "../../scripts/verify-release.ts";
import { TARGETS } from "../../scripts/build.ts";

/**
 * cli#817 — each release publishes its own `install.sh`, staged with the tag and attested in the
 * same bundle as the binaries. The order is load-bearing: staged after the check that `dist/`
 * holds exactly the binaries (it would fail on a sixth file) and before attest (or it is
 * published unsigned). And whatever the bundle covers, the release check verifies.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> };

async function buildSteps(): Promise<Step[]> {
  const wf = parse(await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`)) as {
    jobs: Record<string, { steps?: Step[] }>;
  };
  assert(wf.jobs.build?.steps, "the build job was renamed");
  return wf.jobs.build.steps;
}

const isAttest = (s: Step) => String(s.uses ?? "").startsWith("actions/attest@");

Deno.test("the attestation covers the binaries and the installer, one subject per line", async () => {
  const attest = (await buildSteps()).find(isAttest);
  assert(attest, "nothing attests the build");
  const lines = String(attest.with?.["subject-path"] ?? "").split("\n").map((l) => l.trim())
    .filter(Boolean);
  assertEquals(lines, ["dist/specnaut-*", `dist/${INSTALLER_ASSET_NAME}`]);
});

Deno.test("the installer is staged after the signed-set check and right before attest", async () => {
  const steps = await buildSteps();
  const stage = steps.findIndex((s) => (s.run ?? "").includes("stage-installer.sh"));
  const signedSet = steps.findIndex((s) => s.name?.startsWith("The signed set is exactly"));
  assert(stage >= 0 && signedSet >= 0, "the staging or the signed-set step is gone");
  assert(signedSet < stage, "staged before the signed-set check, which would count it");
  assert(isAttest(steps[stage + 1]), "the step after staging is not the attestation");
  const run = steps[stage].run!;
  assertEquals(
    run.trim(),
    `bash scripts/release/stage-installer.sh "$GITHUB_REF_NAME" dist/${INSTALLER_ASSET_NAME}`,
  );
  assert(!run.includes("${{"), "the tag must reach the shell as a variable, not an expression");
});

Deno.test("the installer is not swept into the checksum loop", () => {
  assert(!INSTALLER_ASSET_NAME.startsWith("specnaut-"), "it would gain a .sha256 sidecar");
});

Deno.test("the release check verifies the installer with the binaries", async () => {
  assertEquals(
    ATTESTED_ASSETS.map((a) => a.outName),
    [...TARGETS.map((t) => t.outName), INSTALLER_ASSET_NAME],
  );
  const dir = await Deno.makeTempDir({ prefix: "verify-installer-" });
  try {
    const anchor = {
      issuerCertDer: new Uint8Array(),
      expectedOidcIssuer: "",
      rekorPublicKeyDer: new Uint8Array(),
    };
    const results = await verifyReleaseDir({ dir, identity: "", anchor });
    const installer = results.find((r) => r.outName === INSTALLER_ASSET_NAME);
    assertEquals(installer?.reason, "missing", "the default subjects leave the installer out");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
