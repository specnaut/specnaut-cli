import type { Downloader, ReleaseChecker } from "./ports.ts";
import { Release, SemVer } from "../domain/release.ts";
import { sha256HexBytes } from "../domain/sha256.ts";
import {
  ATTESTATION_ASSET_NAME,
  expectedSignerIdentity,
  FIRST_SIGNED_VERSION,
  FULCIO_INTERMEDIATE_DER,
  GITHUB_ACTIONS_OIDC_ISSUER,
} from "../domain/sigstore/trust_anchor.ts";
import { verifyArtifact } from "../domain/sigstore/verify.ts";

export type SelfUpdateResult =
  | { status: "up-to-date"; currentVersion: string }
  | { status: "available"; currentVersion: string; latestVersion: string }
  | {
    status: "updated";
    previousVersion: string;
    newVersion: string;
    /** How the bytes were trusted — printed, so a weaker path is never silent. */
    provenance: "signed" | "checksum-only";
    warnings: readonly string[];
  };

export type SelfUpdateDeps = {
  checker: ReleaseChecker;
  downloader: Downloader;
  currentVersion: string;
  currentPlatform: string;
  currentBinaryPath: string;
  replaceBinary: (bytes: Uint8Array) => Promise<void>;
  /** Injected so the certificate-validity check is testable. */
  now?: () => Date;
  /**
   * What issues a valid signing certificate, and which OIDC issuer minted it.
   *
   * Injectable because the alternative is a verifier no test can drive: nobody
   * outside Sigstore can mint a certificate under the real intermediate, so a
   * hard-coded anchor leaves the success path permanently unexercised. It is
   * constructed in exactly one place (`handleSelfUpdate`), is not reachable
   * from any flag or environment variable, and `self_update_test.ts` pins the
   * default to the real Fulcio intermediate so a swap fails the suite.
   */
  trustAnchor?: { issuerCertDer: Uint8Array; expectedOidcIssuer: string };
};

/** The anchor used when the caller supplies none — the shipped policy. */
export const DEFAULT_TRUST_ANCHOR = {
  issuerCertDer: FULCIO_INTERMEDIATE_DER,
  expectedOidcIssuer: GITHUB_ACTIONS_OIDC_ISSUER,
} as const;

/**
 * Releases from before signing existed carry no bundle, and refusing them would
 * strand every user on an older version with no way forward. At or above this
 * version a missing bundle is a failure — which is what makes the transition
 * end rather than degrade into a permanent warning.
 */
function signatureIsRequired(release: Release): boolean {
  return !SemVer.parse(FIRST_SIGNED_VERSION).isNewerThan(release.version);
}

export class SelfUpdateUseCase {
  constructor(private readonly deps: SelfUpdateDeps) {}

  async execute(opts: { checkOnly: boolean }): Promise<SelfUpdateResult> {
    const { checker, downloader, currentVersion, currentPlatform, replaceBinary } = this.deps;

    const current = SemVer.parse(currentVersion);
    const release = await checker.getLatest();

    if (!release.version.isNewerThan(current)) {
      return { status: "up-to-date", currentVersion };
    }

    if (opts.checkOnly) {
      return {
        status: "available",
        currentVersion,
        latestVersion: release.version.toString(),
      };
    }

    const asset = release.assetFor(currentPlatform);
    if (!asset) {
      throw new Error(`No release asset for platform ${currentPlatform}`);
    }
    const checksumAsset = release.checksumAssetFor(currentPlatform);
    if (!checksumAsset) {
      throw new Error(`No checksum asset for platform ${currentPlatform}`);
    }
    const attestationAsset = release.assetNamed(ATTESTATION_ASSET_NAME);

    const [bytes, checksumText, bundleJson] = await Promise.all([
      downloader.download(asset.url),
      downloader.downloadText(checksumAsset.url),
      attestationAsset ? downloader.downloadText(attestationAsset.url) : Promise.resolve(null),
    ]);

    // The checksum stays as a cheap first gate against a corrupted transfer. It
    // is NOT the integrity control any more: it travels beside the binary it
    // describes, so whoever can replace one can replace both. That is the whole
    // reason the signature check below exists.
    const actualSha = await sha256HexBytes(bytes);
    const expectedSha = checksumText.trim().split(/\s+/)[0];
    if (expectedSha !== actualSha) {
      throw new Error(
        `Downloaded binary checksum mismatch: expected ${expectedSha}, got ${actualSha}`,
      );
    }

    const warnings = await this.verifyProvenance(release, bundleJson, actualSha);

    await replaceBinary(bytes);

    return {
      status: "updated",
      previousVersion: currentVersion,
      newVersion: release.version.toString(),
      provenance: bundleJson === null ? "checksum-only" : "signed",
      warnings,
    };
  }

  /**
   * Throws before `replaceBinary` is reached, or returns the warnings to print.
   *
   * Everything about this is fail-closed on purpose. There is no path where an
   * unverifiable signature downgrades to the checksum: an attacker who can
   * amend a release can also serve a bundle the verifier cannot anchor, so a
   * "fall back when verification fails" branch would hand them the old control
   * back on request.
   */
  private async verifyProvenance(
    release: Release,
    bundleJson: string | null,
    artifactSha256: string,
  ): Promise<string[]> {
    const required = signatureIsRequired(release);

    if (bundleJson === null) {
      if (required) {
        throw new Error(
          `Release ${release.version} publishes no signature bundle ` +
            `(${ATTESTATION_ASSET_NAME}), and releases from ${FIRST_SIGNED_VERSION} ` +
            `onward must be signed. Refusing to install. If this is genuine, ` +
            `reinstall from https://specnaut.com rather than bypassing this check.`,
        );
      }
      return [
        `${release.version} predates release signing, so only its checksum could be ` +
        `verified. Signed releases start at ${FIRST_SIGNED_VERSION}.`,
      ];
    }

    const outcome = await verifyArtifact({
      bundleJson,
      artifactSha256,
      now: (this.deps.now ?? (() => new Date()))(),
      anchor: {
        ...(this.deps.trustAnchor ?? DEFAULT_TRUST_ANCHOR),
        expectedSanUri: expectedSignerIdentity(release.version.toString()),
      },
    });
    if (outcome.ok) return [];

    // A bundle that is present but does not verify is always fatal, including
    // below the transition version — publishing one is a claim, and a claim
    // that fails to check is worse evidence than none.
    const hint = outcome.reason === "untrusted-issuer" || outcome.reason === "certificate-expired"
      ? " If Sigstore has rotated its certificate authority, this binary needs " +
        "reinstalling from https://specnaut.com rather than updating."
      : "";
    throw new Error(
      `Refusing to install ${release.version}: signature verification failed ` +
        `(${outcome.reason}). ${outcome.detail}.${hint}`,
    );
  }
}
