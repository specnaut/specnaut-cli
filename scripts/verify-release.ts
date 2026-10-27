// Verifies published release artefacts with the SHIPPED verifier (cli#595).
//
// Usage: deno run --allow-read scripts/verify-release.ts --tag v4.3.0 --dir <downloaded>
//        deno run --allow-read scripts/verify-release.ts --dry-run-ref refs/heads/main --dir <artefacts>
//
// `--dry-run-ref` (cli#662) verifies what `go-dry-run.yml` attested: the
// identity is DERIVED from the ref — that workflow, that ref, exact match —
// never passed in, and the flag is exclusive with `--tag`. No version is
// needed: a dry run's identity names a ref, not a tag. A release never passes
// it (tests/scripts/verify_release_test.ts holds postflight and release.yml to
// that), and the shipped verifier under src/domain/sigstore/ is untouched —
// `self_update.ts` still demands the release identity.
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
import { RELEASE_REPO } from "../src/domain/release.ts";
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
  /** The exact certificate identity every artefact must carry (see `identityFor`). */
  readonly identity: string;
  readonly anchor: {
    readonly issuerCertDer: Uint8Array;
    readonly expectedOidcIssuer: string;
    readonly rekorPublicKeyDer: Uint8Array;
  };
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
      anchor: { ...opts.anchor, expectedSanUri: opts.identity },
    });
    results.push(
      outcome.ok
        ? { outName: t.outName, ok: true, reason: "", detail: outcome.identity }
        : { outName: t.outName, ok: false, reason: outcome.reason, detail: outcome.detail },
    );
  }
  return results;
}

/** The workflow whose dispatch-only dry run attests the Go artefacts. */
export const DRY_RUN_WORKFLOW_PATH = ".github/workflows/go-dry-run.yml";

/**
 * The identity a dry run's certificate carries for `ref`, derived as
 * `expectedSignerIdentity` derives a release's: the repository, the workflow
 * file, the ref, nothing pattern-matched.
 */
export function dryRunSignerIdentity(ref: string): string {
  return `https://github.com/${RELEASE_REPO}/${DRY_RUN_WORKFLOW_PATH}@${ref}`;
}

/**
 * Which identity the command line asks for: exactly one of `--tag` (a
 * release) or `--dry-run-ref` (a dry run). Both, or neither, is a usage
 * error — never a precedence rule, which would let a dry-run identity stand
 * in for a release check.
 */
export function identityFor(
  opts: { tag: string | null; dryRunRef: string | null },
): { identity: string; label: string } | null {
  if ((opts.tag === null) === (opts.dryRunRef === null)) return null;
  if (opts.tag !== null) {
    return { identity: expectedSignerIdentity(opts.tag.replace(/^v/, "")), label: opts.tag };
  }
  const ref = opts.dryRunRef!;
  // A branch or tag ref spelled with plain characters only: the match is exact
  // anyway, but a `*` here would read as a pattern to whoever runs it.
  if (!/^refs\/(heads|tags)\/[A-Za-z0-9._\/-]+$/.test(ref)) return null;
  return { identity: dryRunSignerIdentity(ref), label: `the dry run on ${ref}` };
}

/**
 * `--only <asset>` narrows the check to one published binary — for a runner
 * that downloaded only the asset it is about to execute (go-dry-run.yml's
 * measure job). The name must be one `TARGETS` emits; anything else is a
 * usage error, never "verified nothing". Absent, every target is checked, as
 * postflight requires.
 */
export function targetsFor(only: string | null): readonly { readonly outName: string }[] | null {
  if (only === null) return TARGETS;
  const t = TARGETS.find((x) => x.outName === only);
  return t ? [t] : null;
}

function arg(name: string): string | null {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < Deno.args.length ? Deno.args[i + 1] : null;
}

async function main(): Promise<number> {
  const dir = arg("dir");
  const wanted = identityFor({ tag: arg("tag"), dryRunRef: arg("dry-run-ref") });
  const targets = targetsFor(arg("only"));
  if (wanted === null || dir === null || targets === null) {
    console.error(
      "usage: verify-release.ts (--tag <vX.Y.Z> | --dry-run-ref refs/heads/<branch>) --dir <dir> " +
        "[--only <asset>]",
    );
    return 2;
  }
  const tag = wanted.label;

  const results = await verifyReleaseDir({
    dir,
    identity: wanted.identity,
    anchor: DEFAULT_TRUST_ANCHOR,
    targets,
  });
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
