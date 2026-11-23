import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parse } from "@std/yaml";
import { verifyReleaseDir } from "../../scripts/verify-release.ts";
import {
  INSTALLER_ASSET_NAME,
  INSTALLER_ATTESTATION_ASSET_NAME,
} from "../../scripts/release/attestation-bundles.ts";
import { ATTESTATION_ASSET_NAME } from "../../src/domain/sigstore/trust_anchor.ts";
import { TARGETS } from "../../scripts/build.ts";

/**
 * Each release publishes its own `install.sh`, staged with the tag and attested in its own bundle,
 * so the binary bundle's subjects are the binaries alone. The order is load-bearing: staged after
 * the check that `dist/` holds exactly the binaries (it would fail on a sixth file), right before
 * its attestation (or it is published unsigned), and every bundle's subjects are checked before
 * the upload.
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
const subjectsOf = (s: Step) =>
  String(s.with?.["subject-path"] ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

Deno.test("the binaries and the installer are attested in two steps, one bundle each", async () => {
  const attests = (await buildSteps()).filter(isAttest);
  assertEquals(attests.map(subjectsOf), [["dist/specnaut-*"], [`dist/${INSTALLER_ASSET_NAME}`]]);
});

Deno.test("the installer is staged after the signed-set check and right before its attestation", async () => {
  const steps = await buildSteps();
  const stage = steps.findIndex((s) => (s.run ?? "").includes("stage-installer.sh"));
  const signedSet = steps.findIndex((s) => s.name?.startsWith("The signed set is exactly"));
  assert(stage >= 0 && signedSet >= 0, "the staging or the signed-set step is gone");
  assert(signedSet < stage, "staged before the signed-set check, which would count it");
  assert(isAttest(steps[stage + 1]), "the step after staging is not an attestation");
  assertEquals(subjectsOf(steps[stage + 1]), [`dist/${INSTALLER_ASSET_NAME}`]);
  const run = steps[stage].run!;
  assertEquals(
    run.trim(),
    `bash scripts/release/stage-installer.sh "$GITHUB_REF_NAME" dist/${INSTALLER_ASSET_NAME}`,
  );
  assert(!run.includes("${{"), "the tag must reach the shell as a variable, not an expression");
});

Deno.test("every staged bundle's subjects are checked before the upload", async () => {
  const steps = await buildSteps();
  const check = steps.findIndex((s) =>
    (s.run ?? "").includes("deno run --allow-read scripts/release/attestation-bundles.ts dist")
  );
  const upload = steps.findIndex((s) => s.name === "Create release");
  assert(check >= 0, "nothing checks the bundles' subjects before they are published");
  assert(check < upload, "the subject check runs after the upload");
  const run = steps[check].run!;
  for (const name of [ATTESTATION_ASSET_NAME, INSTALLER_ATTESTATION_ASSET_NAME]) {
    assert(run.indexOf(`dist/${name}`) >= 0, `${name} is not staged where the check reads it`);
    assert(run.indexOf(`dist/${name}`) < run.indexOf("attestation-bundles.ts"), `${name} late`);
  }
});

Deno.test("the installer is not swept into the checksum loop", () => {
  assert(!INSTALLER_ASSET_NAME.startsWith("specnaut-"), "it would gain a .sha256 sidecar");
});

Deno.test("the release check reads each asset against its own bundle", async () => {
  // Only the binary bundle is present, and it is not a bundle: the installer must be reported for
  // its own absent bundle, the binaries for the one that does not parse.
  const dir = await Deno.makeTempDir({ prefix: "verify-installer-" });
  try {
    await Deno.writeTextFile(`${dir}/${ATTESTATION_ASSET_NAME}`, "not a bundle");
    for (const t of TARGETS) await Deno.writeTextFile(`${dir}/${t.outName}`, t.outName);
    await Deno.writeTextFile(`${dir}/${INSTALLER_ASSET_NAME}`, "#!/usr/bin/env bash\n");
    const anchor = {
      issuerCertDer: new Uint8Array(),
      expectedOidcIssuer: "",
      rekorPublicKeyDer: new Uint8Array(),
    };
    const results = await verifyReleaseDir({ dir, identity: "", anchor });
    assertEquals(
      results.map((r) => r.outName),
      [...TARGETS.map((t) => t.outName), INSTALLER_ASSET_NAME],
    );
    const installer = results.find((r) => r.outName === INSTALLER_ASSET_NAME);
    assertEquals(installer?.reason, "no-bundle", "the installer was read against another bundle");
    const binaries = results.filter((r) => r.outName !== INSTALLER_ASSET_NAME);
    assert(binaries.every((r) => r.reason !== "no-bundle" && !r.ok), "binaries lost their bundle");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
