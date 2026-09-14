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

/**
 * Verify every published binary in `dir` against the bundle beside it.
 *
 * The anchor is a parameter rather than a constant so the negative self-test
 * can drive this with a synthetic authority. Production passes the compiled-in
 * one — see `main` — so the shipped policy is what a real release is judged by.
 */
export async function verifyReleaseDir(opts: {
  readonly dir: string;
  readonly version: string;
  readonly anchor: { readonly issuerCertDer: Uint8Array; readonly expectedOidcIssuer: string };
  readonly now?: Date;
  readonly targets?: readonly { readonly outName: string }[];
}): Promise<ArtifactVerification[]> {
  const targets = opts.targets ?? TARGETS;
  const now = opts.now ?? new Date();

  let bundleJson: string | null;
  try {
    bundleJson = await Deno.readTextFile(`${opts.dir}/${ATTESTATION_ASSET_NAME}`);
  } catch {
    bundleJson = null; // the verifier reports this as `no-bundle`, per artefact
  }

  const results: ArtifactVerification[] = [];
  for (const t of targets) {
    let sha: string;
    try {
      sha = await sha256OfFile(`${opts.dir}/${t.outName}`);
    } catch {
      results.push({
        outName: t.outName,
        ok: false,
        reason: "missing",
        detail: "the published release does not carry this binary, or it was not downloaded",
      });
      continue;
    }
    const outcome: VerificationOutcome = await verifyArtifact({
      bundleJson,
      artifactSha256: sha,
      now,
      anchor: { ...opts.anchor, expectedSanUri: expectedSignerIdentity(opts.version) },
    });
    results.push(
      outcome.ok
        ? { outName: t.outName, ok: true, reason: "", detail: outcome.identity }
        : { outName: t.outName, ok: false, reason: outcome.reason, detail: outcome.detail },
    );
  }
  return results;
}

function arg(name: string): string | null {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < Deno.args.length ? Deno.args[i + 1] : null;
}

async function main(): Promise<number> {
  const tag = arg("tag");
  const dir = arg("dir");
  if (tag === null || dir === null) {
    console.error("usage: verify-release.ts --tag <vX.Y.Z> --dir <downloaded-assets-dir>");
    return 2;
  }
  const version = tag.replace(/^v/, "");

  const results = await verifyReleaseDir({ dir, version, anchor: DEFAULT_TRUST_ANCHOR });
  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log(`  ✓ ${r.outName}`);
    } else {
      // Name the binary AND the verifier's own reason: the operator reading
      // this is mid-release and should not have to re-derive either.
      console.error(`  ❌ ${r.outName} — ${r.reason}: ${r.detail}`);
      failed++;
    }
  }
  if (failed > 0) {
    console.error(
      `❌ ${failed}/${results.length} published binaries do not verify against ` +
        `the attestation for ${tag}.`,
    );
    console.error(
      "   Every installed client runs this same check, so they will refuse this " +
        "release. Publish a patch, or unpublish.",
    );
    return 1;
  }
  console.log(`✓ all ${results.length} published binaries verify against the ${tag} attestation`);
  return 0;
}

if (import.meta.main) Deno.exit(await main());
