// Verifies published release artefacts with the SHIPPED verifier (cli#595).
//
// Usage: deno run --allow-read scripts/verify-release.ts --tag v4.3.0 --dir <downloaded>
//
// `postflight.sh` already checked two things about the attestation: that the
// certificate SAN ends with `@refs/tags/$TAG`, and that the signed statement's
// subject COUNT matches the compiler's target list. Those catch a wrong-tag
// bundle and a short glob. They never touched the issuer chain, the DSSE
// signature, or the artefact digests — the legs whose failure is actually fatal.
//
// The reason that gap mattered more than it looks: every binary installing
// 4.3.0 predates the verifier and installs on checksum alone, so
// `FIRST_SIGNED_VERSION` means the verifier is first exercised at 4.3.1, by
// users who installed 4.3.0. A defect in an unchecked leg would stay silent for
// one whole release, by which point that release is immutable.
//
// **It calls the shipped `verifyArtifact`, deliberately.** Re-implementing the
// checks in shell would verify a different thing than users run, which forfeits
// the entire point: the question is not "is this bundle valid by some standard"
// but "will the code in users' hands accept it".
//
// This also subsumes both earlier checks rather than sitting beside them. A
// per-binary digest check is strictly stronger than a subject count — a bundle
// omitting one platform fails that platform's digest — and `expectedSanUri` is
// the identity check the SAN grep was approximating. Two spellings of one rule
// is how they drift.

import { type VerificationOutcome, verifyArtifact } from "../src/domain/sigstore/verify.ts";
import {
  ATTESTATION_ASSET_NAME,
  expectedSignerIdentity,
} from "../src/domain/sigstore/trust_anchor.ts";
import { DEFAULT_TRUST_ANCHOR } from "../src/application/self_update.ts";
import { TARGETS } from "./build.ts";

export type ArtifactVerification = {
  readonly outName: string;
  readonly ok: boolean;
  /** The verifier's own refusal reason, or `missing` when the file is absent. */
  readonly reason: string;
  readonly detail: string;
};

async function sha256OfFile(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Anchor = {
  readonly issuerCertDer: Uint8Array;
  readonly expectedOidcIssuer: string;
  readonly rekorPublicKeyDer: Uint8Array;
};

/**
 * Verify every published binary in `dir` against the bundle beside it.
 *
 * The anchor is a parameter rather than a constant so the negative self-test
 * can drive this with a synthetic authority. Production passes the compiled-in
 * one — see `main` — so the shipped policy is what a real release is judged by.
 */
export async function verifyReleaseDir(opts: {
  readonly dir: string;
  /** The exact certificate identity every artefact must carry (see `parseCommandLine`). */
  readonly identity: string;
  readonly anchor: Anchor;
  readonly now?: Date;
  readonly targets?: readonly { readonly outName: string }[];
}): Promise<ArtifactVerification[]> {
  const bundleJson = await readBundle(opts.dir);
  const check = { ...opts, bundleJson, now: opts.now ?? new Date() };
  const results: ArtifactVerification[] = [];
  for (const t of opts.targets ?? TARGETS) results.push(await verifyOne(t.outName, check));
  return results;
}

/** The bundle beside the binaries, or null — which the verifier reports as
 *  `no-bundle`, per artefact, rather than this script deciding for it. */
async function readBundle(dir: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(`${dir}/${ATTESTATION_ASSET_NAME}`);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

/** One binary: `missing` when absent, else the shipped verifier's verdict. */
async function verifyOne(outName: string, c: {
  readonly dir: string;
  readonly identity: string;
  readonly anchor: Anchor;
  readonly now: Date;
  readonly bundleJson: string | null;
}): Promise<ArtifactVerification> {
  let sha: string;
  try {
    sha = await sha256OfFile(`${c.dir}/${outName}`);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
    const detail = "the published release does not carry this binary, or it was not downloaded";
    return { outName, ok: false, reason: "missing", detail };
  }
  const outcome: VerificationOutcome = await verifyArtifact({
    bundleJson: c.bundleJson,
    artifactSha256: sha,
    now: c.now,
    anchor: { ...c.anchor, expectedSanUri: c.identity },
  });
  return outcome.ok
    ? { outName, ok: true, reason: "", detail: outcome.identity }
    : { outName, ok: false, reason: outcome.reason, detail: outcome.detail };
}

const USAGE = "usage: verify-release.ts --tag <vX.Y.Z> --dir <dir>";

/**
 * What the command line asks for, or null for a usage error (exit 2). The identity is derived from
 * the tag — release.yml at `refs/tags/<tag>` — and never taken from an argument, so nothing on the
 * command line can make another workflow's certificate pass for a release's.
 */
export function parseCommandLine(
  args: readonly string[],
): { dir: string; tag: string; identity: string } | null {
  const arg = (name: string): string | null => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const dir = arg("dir");
  const tag = arg("tag");
  if (dir === null || tag === null) return null;
  return { dir, tag, identity: expectedSignerIdentity(tag.replace(/^v/, "")) };
}

/** Prints one line per binary and the verdict; returns the exit code. */
function report(results: readonly ArtifactVerification[], label: string): number {
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    // Name the binary AND the verifier's own reason: the operator reading
    // this is mid-release and should not have to re-derive either.
    if (r.ok) console.log(`  ✓ ${r.outName}`);
    else console.error(`  ❌ ${r.outName} — ${r.reason}: ${r.detail}`);
  }
  if (failed.length === 0) {
    console.log(
      `✓ all ${results.length} published binaries verify against the ${label} attestation`,
    );
    return 0;
  }
  console.error(
    `❌ ${failed.length}/${results.length} published binaries do not verify against ` +
      `the attestation for ${label}.`,
  );
  console.error(
    "   Every installed client runs this same check, so they will refuse this " +
      "release. Publish a patch, or unpublish.",
  );
  return 1;
}

async function main(): Promise<number> {
  const cmd = parseCommandLine(Deno.args);
  if (cmd === null) {
    console.error(USAGE);
    return 2;
  }
  const { dir, tag, identity } = cmd;
  const results = await verifyReleaseDir({ dir, identity, anchor: DEFAULT_TRUST_ANCHOR });
  return report(results, tag);
}

if (import.meta.main) Deno.exit(await main());
