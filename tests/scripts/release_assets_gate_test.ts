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
  // `artifact-metadata: write` is a VALID permissions key — `actions/attest`'s
  // README uses it, in its container-image example, the one that pushes to a
  // registry. It is absent here because it buys nothing: the permission is
  // consumed only when a storage record is written, the action gates that
  // behind `push-to-registry`, and the step sets `create-storage-record: false`
  // and pushes to no registry.
  //
  // This comment used to question whether the key was valid at all, and rest
  // the constraint on that. It was checkable, and wrong. A correct constraint
  // defended by a false premise is one the next reader deletes the moment they
  // check it — so the reason above is the one that actually holds (cli#597).
  assert(
    !("artifact-metadata" in (build.permissions ?? {})),
    "artifact-metadata grants a permission this workflow never uses — it is " +
      "consumed only when pushing a storage record to a registry, which this " +
      "job does not do",
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

// ── The Go dry run copies the release's shape (cli#662) ─────────────────────
//
// `go-dry-run.yml` cannot reuse release.yml's steps — that would need a
// callable release.yml, which release_actions_pinned_test.ts forbids — so it
// copies them. A copy is guarded here: the dry run proves the release shape
// only while its attest step and checksum loop ARE the release's.

type AnyStep = Step & { uses?: string; run?: string };

async function allSteps(file: string): Promise<AnyStep[]> {
  const wf = parse(await Deno.readTextFile(`${ROOT}.github/workflows/${file}`)) as {
    jobs: Record<string, { steps?: AnyStep[] }>;
  };
  return Object.values(wf.jobs).flatMap((j) => j.steps ?? []);
}

Deno.test("the dry run attests with release.yml's exact action SHA and inputs", async () => {
  const pick = (steps: AnyStep[]) => steps.filter((s) => s.uses?.startsWith("actions/attest@"));
  const [release, dryRun] = [
    pick(await allSteps("release.yml")),
    pick(await allSteps("go-dry-run.yml")),
  ];
  assertEquals(release.length, 1, "release.yml no longer has exactly one attest step");
  assertEquals(dryRun.length, 1, "go-dry-run.yml must attest exactly once");
  assertEquals(dryRun[0].uses, release[0].uses, "the dry run attests with a different action SHA");
  assertEquals(dryRun[0].with, release[0].with, "the dry run attests with different inputs");
});

Deno.test("the dry run checksums with release.yml's exact loop, and stages the same bundle name", async () => {
  const loop = (steps: AnyStep[]) => steps.find((s) => s.name === "Compute checksums")?.run;
  const dryRun = await allSteps("go-dry-run.yml");
  const releaseLoop = loop(await allSteps("release.yml"));
  assert(releaseLoop, "release.yml has no 'Compute checksums' step");
  assertEquals(loop(dryRun), releaseLoop, "the dry run's checksum loop differs from the release's");
  const stage = dryRun.find((s) => s.run?.includes("cp "));
  assert(
    stage?.run?.includes(`dist/${ATTESTATION_ASSET_NAME}`),
    `the dry run does not stage the bundle as ${ATTESTATION_ASSET_NAME}`,
  );
});
