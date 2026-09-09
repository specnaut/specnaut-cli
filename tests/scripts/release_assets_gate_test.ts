import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parse } from "@std/yaml";
import { ATTESTATION_ASSET_NAME } from "../../src/domain/sigstore/trust_anchor.ts";

/**
 * #521 — `Create release` could publish a short asset set and still exit 0.
 *
 * `softprops/action-gh-release` defaults `fail_on_unmatched_files` to false, so
 * nine of ten files present meant it uploaded nine, created the release, and
 * marked the step green. A tag and its release are effectively immutable, so
 * the only recovery is another patch — and until that ships, every user on the
 * missing platform gets a 404 from `install.sh` and `self-update`, both of
 * which resolve assets by tag.
 *
 * The tests below also pin the three numbers that have to agree and live in
 * three different files: the compiler's target list, the workflow's upload
 * list, and postflight's `asset_count` floor. Adding a platform touches all
 * three, and nothing else would notice if it touched only two.
 *
 * Since #577 there is a fourth agreement, and it is a name rather than a count:
 * the workflow uploads a Sigstore bundle, and `self-update` refuses a release
 * at or above the signing floor that does not carry one. The updater resolves
 * that asset by exact name, so a rename in the workflow alone would publish a
 * release every installed binary rejects — with the checksum still passing, so
 * nothing upstream of the user would notice.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

type Step = { name?: string; with?: Record<string, unknown> };
type Workflow = { jobs: Record<string, { steps?: Step[] }> };

async function releaseWorkflow(): Promise<Workflow> {
  return parse(
    await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`),
  ) as Workflow;
}

function createReleaseStep(wf: Workflow): Step {
  const steps = Object.values(wf.jobs).flatMap((j) => j.steps ?? []);
  const step = steps.find((s) => s.name === "Create release");
  assert(step, "no 'Create release' step in release.yml — did it get renamed?");
  return step;
}

Deno.test("Create release fails rather than publishing a short asset set", async () => {
  const step = createReleaseStep(await releaseWorkflow());
  assertEquals(
    step.with?.fail_on_unmatched_files,
    true,
    "without this the action publishes whatever it found and reports success; " +
      "the release is immutable by the time postflight notices",
  );
});

Deno.test("the workflow uploads a binary and a checksum for every built target", async () => {
  const step = createReleaseStep(await releaseWorkflow());
  const files: string[] = String(step.with?.files ?? "")
    .split("\n").map((l) => l.trim()).filter(Boolean);

  const build = await Deno.readTextFile(`${ROOT}scripts/build.ts`);
  const outNames = [...build.matchAll(/outName:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert(outNames.length > 0, "could not read the target list out of scripts/build.ts");

  for (const name of outNames) {
    // build.ts appends .exe for Windows; match on the stem so both shapes pass.
    const binary = files.find((f) => f.startsWith(`dist/${name}`) && !f.endsWith(".sha256"));
    assert(binary, `${name} is built but never uploaded — users of that platform get a 404`);
    assert(
      files.includes(`${binary}.sha256`),
      `${binary} is uploaded without its checksum`,
    );
  }
  // Named, not merely counted. Counting `outNames.length * 2 + 1` passes on any
  // stray eleventh file, including a renamed bundle — which is the one failure
  // that reaches users as a refused update.
  const extras = files.filter((f) =>
    !outNames.some((n) => f === `dist/${n}` || f === `dist/${n}.sha256`)
  );
  assertEquals(
    extras,
    [`dist/${ATTESTATION_ASSET_NAME}`],
    `beyond one binary + one checksum per target, the release publishes exactly ` +
      `the attestation bundle — nothing else, and not under another name`,
  );
  assertEquals(
    files.length,
    outNames.length * 2 + 1,
    `${outNames.length} targets → ${outNames.length * 2} per-target files, plus ` +
      `the attestation bundle`,
  );
});

Deno.test("the attestation bundle cannot be swept into the checksum loop", async () => {
  // `for f in specnaut-*` runs over dist/ and writes a .sha256 beside every
  // match. A bundle whose name matched would gain a sidecar and make the
  // published asset set one larger than every gate expects.
  const raw = await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`);
  assert(
    raw.includes("for f in specnaut-*"),
    "the checksum loop changed shape — re-derive what the bundle name must avoid",
  );
  assert(
    !ATTESTATION_ASSET_NAME.startsWith("specnaut-"),
    `${ATTESTATION_ASSET_NAME} matches specnaut-* and would be checksummed too`,
  );
});

Deno.test("the release is attested by a workflow-identity signature, with no stored secret", async () => {
  const wf = await releaseWorkflow() as unknown as {
    jobs: Record<string, { permissions?: Record<string, string>; steps?: Step[] }>;
  };
  const build = wf.jobs.build;
  assert(build, "the build job was renamed");
  // Keyless signing needs exactly these two beyond what the job already held.
  assertEquals(build.permissions?.["id-token"], "write");
  assertEquals(build.permissions?.["attestations"], "write");
  // An invalid permissions key fails the workflow parse on a tag push, which
  // would mean no release at all. This one is unconfirmed as a valid key and
  // buys nothing without a registry push.
  assert(
    !("artifact-metadata" in (build.permissions ?? {})),
    "artifact-metadata is not needed here and risks a workflow parse failure",
  );

  const steps = build.steps ?? [];
  const attestAt = steps.findIndex((s) =>
    String((s as { uses?: string }).uses ?? "").startsWith("actions/attest@")
  );
  const checksumAt = steps.findIndex((s) => s.name === "Compute checksums");
  assert(attestAt >= 0, "nothing attests the build — the release would be checksum-only again");
  assert(
    attestAt < checksumAt,
    "attest must run before checksums exist, or its dist/specnaut-* glob picks up sidecars",
  );
});

Deno.test("postflight's asset floor matches what the workflow uploads", async () => {
  const step = createReleaseStep(await releaseWorkflow());
  const uploaded = String(step.with?.files ?? "")
    .split("\n").map((l) => l.trim()).filter(Boolean).length;

  const postflight = await Deno.readTextFile(`${ROOT}.specnaut/release/postflight.sh`);
  const m = postflight.match(/asset_count"?\s*-ge\s*(\d+)/);
  assert(m, "postflight no longer asserts a minimum asset count");
  assertEquals(
    Number(m[1]),
    uploaded,
    "postflight is the second net; a floor below the upload count lets a short " +
      "release pass both gates — and the attestation bundle counts, because a " +
      "release missing it is one every current binary refuses to install",
  );
});
