// Which attestation bundle covers which release asset, and the check that a staged bundle covers
// exactly those.
//
// Usage: deno run --allow-read scripts/release/attestation-bundles.ts <dir>
//
// release.yml attests the binaries and the installer in two steps, so each bundle names one kind
// of asset: a digest in the binary bundle is a binary's, never the installer's. `self-update` and
// install.sh look a binary up in that bundle only. The workflow runs this on the staged bundles
// before upload, and a bundle holding a subject it should not, or missing one, fails the release.

import { parseBundles } from "../../src/domain/sigstore/bundle.ts";
import { parseSubjects } from "../../src/domain/sigstore/in_toto.ts";
import { ATTESTATION_ASSET_NAME } from "../../src/domain/sigstore/trust_anchor.ts";
import { TARGETS } from "../build.ts";

/** The installer each release publishes, with its tag written in. */
export const INSTALLER_ASSET_NAME = "install.sh";

/** The installer's own bundle. Not `specnaut-*`, or the checksum loop would give it a sidecar. */
export const INSTALLER_ATTESTATION_ASSET_NAME = "installer.attestation.sigstore.json";

export type AttestationBundle = {
  /** The bundle's asset name. */
  readonly bundle: string;
  /** The asset names its statement must cover, and nothing else. */
  readonly subjects: readonly string[];
};

/** Every bundle a release publishes, each with exactly the assets it attests. */
export const ATTESTATION_BUNDLES: readonly AttestationBundle[] = [
  { bundle: ATTESTATION_ASSET_NAME, subjects: TARGETS.map((t) => t.outName) },
  { bundle: INSTALLER_ATTESTATION_ASSET_NAME, subjects: [INSTALLER_ASSET_NAME] },
];

/**
 * Every release asset beyond one binary and one checksum per target, sorted. Read by the
 * workflow's asset gate test, so the upload list and what is verified cannot drift apart.
 */
export const RELEASE_EXTRAS = [
  INSTALLER_ASSET_NAME,
  ...ATTESTATION_BUNDLES.map((b) => b.bundle),
].sort();

/** What is wrong with `bundleJson` as the bundle for `expected`; empty when it covers exactly those. */
export function subjectProblems(bundleJson: string, expected: readonly string[]): string[] {
  const names = parseBundles(bundleJson).flatMap((b) =>
    parseSubjects(b.payload).map((s) => s.name)
  );
  return [
    ...names.filter((n) => !expected.includes(n)).map((n) => `${n} does not belong in it`),
    ...expected.filter((n) => !names.includes(n)).map((n) => `${n} is missing from it`),
  ];
}

async function problemsOf(path: string, expected: readonly string[]): Promise<string[]> {
  try {
    return subjectProblems(await Deno.readTextFile(path), expected);
  } catch (err) {
    return [`cannot be read as a bundle: ${(err as Error).message}`];
  }
}

/** Checks every bundle staged in `dir`; returns the exit code. */
async function main(dir: string | undefined): Promise<number> {
  if (!dir) {
    console.error("usage: attestation-bundles.ts <dir>");
    return 2;
  }
  let failed = false;
  for (const b of ATTESTATION_BUNDLES) {
    const problems = await problemsOf(`${dir}/${b.bundle}`, b.subjects);
    for (const p of problems) console.error(`::error::${b.bundle}: ${p}`);
    if (problems.length > 0) failed = true;
    else console.log(`ok ${b.bundle}: ${b.subjects.join(", ")}`);
  }
  return failed ? 1 : 0;
}

if (import.meta.main) Deno.exit(await main(Deno.args[0]));
