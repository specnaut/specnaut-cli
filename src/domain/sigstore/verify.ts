/**
 * The verifier. One trust decision, made from a pinned certificate authority
 * and a pinned signer identity, over an artefact digest.
 *
 * **What a pass means, exactly.** These bytes carry a DSSE signature made by a
 * key whose certificate was issued by the pinned authority to the pinned
 * workflow identity, and the signed statement covers this artefact's SHA-256.
 *
 * **What a pass does NOT mean.** It is not a claim of transparency-log
 * inclusion (see `bundle.ts`), not a revocation check, and not a statement
 * about what the workflow actually built. Writing the boundary down is the
 * point: a verifier that is vague about its guarantee gets cited for one it
 * never made.
 *
 * Every failure is a NAMED reason rather than a thrown error, because each one
 * has to be reachable in a test. A gate whose failure paths have never gone red
 * is a gate nobody has checked.
 */

import { parseBundles, type SigstoreBundle } from "./bundle.ts";
import { preAuthEncoding } from "./dsse.ts";
import { parseSubjects } from "./in_toto.ts";
import { decodeBase64 } from "@std/encoding/base64";
import { derEcdsaToP1363 } from "./der.ts";
import { hashForSignatureAlgorithm, parseCertificate, type X509Cert } from "./x509.ts";

export type VerificationFailure =
  /** No signature material was published for this release at all. */
  | "no-bundle"
  /** Present but unreadable — truncated, wrong shape, bad base64. */
  | "malformed-bundle"
  /** The signing certificate was not issued by the pinned authority. */
  | "untrusted-issuer"
  /** The signing certificate was not valid when the signature was made. */
  | "certificate-expired"
  /** No SIGNED statement of when the signature was made — so no time to judge it at. */
  | "untrusted-timestamp"
  /** Signed by a real Fulcio certificate, but not by the identity we pin. */
  | "identity-mismatch"
  /** The DSSE signature does not verify under the certificate's key. */
  | "signature-invalid"
  /** Signed statement is authentic but covers different bytes. */
  | "digest-mismatch";

export type VerificationOutcome =
  | { readonly ok: true; readonly identity: string }
  | { readonly ok: false; readonly reason: VerificationFailure; readonly detail: string };

export type TrustAnchor = {
  /**
   * DER of the certificate that must have issued the signing certificate.
   *
   * Pinning the ISSUER rather than a root removes path building entirely: there
   * is one hop to check and no chain to assemble, which is most of what an
   * X.509 verifier gets wrong. The cost is stated in `trust_anchor.ts`.
   */
  readonly issuerCertDer: Uint8Array;
  /** The exact SAN URI the signing certificate must carry. */
  readonly expectedSanUri: string;
  /** The OIDC issuer Fulcio must have recorded. */
  readonly expectedOidcIssuer: string;
  /**
   * SPKI DER of the transparency log whose Signed Entry Timestamp establishes
   * WHEN the signature was made.
   *
   * An anchor, not a constant, for the same reason the issuer is: a test must
   * be able to mint its own log. Production passes the pinned public-good key.
   */
  readonly rekorPublicKeyDer: Uint8Array;
};

function fail(reason: VerificationFailure, detail: string): VerificationOutcome {
  return { ok: false, reason, detail };
}

async function ecdsaVerify(
  spki: Uint8Array,
  curve: X509Cert["curve"],
  hash: "SHA-256" | "SHA-384",
  derSignature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  let key: CryptoKey;
  let signature: Uint8Array;
  try {
    key = await crypto.subtle.importKey(
      "spki",
      spki as unknown as BufferSource,
      { name: "ECDSA", namedCurve: curve.name },
      false,
      ["verify"],
    );
    signature = derEcdsaToP1363(derSignature, curve.coordBytes);
  } catch {
    // A key or signature this reader cannot make sense of is not a verified
    // signature. Returning false rather than throwing keeps every caller on the
    // named-reason path.
    return false;
  }
  return await crypto.subtle.verify(
    { name: "ECDSA", hash },
    key,
    signature as unknown as BufferSource,
    message as unknown as BufferSource,
  );
}

/**
 * How far a check got, so the reported failure is the most informative one.
 *
 * With several bundles over the same digest, the interesting failure is never
 * the first: GitHub's own release attestation fails at `untrusted-issuer` every
 * time, and reporting that would bury a real `digest-mismatch` on the bundle
 * this project actually signed.
 */
const PROGRESS: Record<VerificationFailure, number> = {
  "no-bundle": 0,
  "malformed-bundle": 1,
  "untrusted-issuer": 2,
  "untrusted-timestamp": 3,
  "certificate-expired": 4,
  "identity-mismatch": 5,
  "signature-invalid": 6,
  "digest-mismatch": 7,
};

/**
 * The instant the transparency log says it saw this signature, or `null`.
 *
 * `null` means "no TRUSTED time", never "no time": a bundle with no log entry
 * and a bundle whose Signed Entry Timestamp does not verify are both states
 * where the only available answer is one an attacker could have written.
 *
 * ## What the SET covers, and why the shape is exact
 *
 * Rekor signs the RFC 8785 canonical JSON of four fields — `body`,
 * `integratedTime`, `logID`, `logIndex` — with its own key. Canonical means
 * keys sorted and no whitespace, and `logID` is the HEX of the key id the
 * bundle carries as base64. Every one of those details is load-bearing: a
 * single byte out of place produces a valid-looking payload whose signature
 * simply does not verify, which is indistinguishable from tampering.
 *
 * The pinned key is checkable rather than asserted: its SHA-256 is the `logId`
 * every published bundle names, so anyone can confirm the pin against a real
 * attestation.
 */
async function verifiedSigningTime(
  bundle: SigstoreBundle,
  anchor: TrustAnchor,
): Promise<Date | null> {
  const t = bundle.tlog;
  if (t === undefined) return null;

  const integrated = Number(t.integratedTime);
  const index = Number(t.logIndex);
  if (!Number.isSafeInteger(integrated) || integrated <= 0) return null;
  if (!Number.isSafeInteger(index) || index < 0) return null;

  let logIdHex: string;
  try {
    logIdHex = [...decodeBase64(t.logIdKeyId)]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }

  // Key order is alphabetical because the canonical form demands it, not as a
  // matter of taste. Written as a literal rather than sorted at runtime so the
  // shape is reviewable against Rekor's own definition.
  const canonical = JSON.stringify({
    body: t.canonicalizedBody,
    integratedTime: integrated,
    logID: logIdHex,
    logIndex: index,
  });

  const ok = await ecdsaVerify(
    anchor.rekorPublicKeyDer,
    { name: "P-256", coordBytes: 32 },
    "SHA-256",
    t.signedEntryTimestamp,
    new TextEncoder().encode(canonical),
  );
  return ok ? new Date(integrated * 1000) : null;
}

async function verifyOne(
  bundle: SigstoreBundle,
  artifactSha256: string,
  now: Date,
  anchor: TrustAnchor,
  issuer: X509Cert,
): Promise<VerificationOutcome> {
  let leaf: X509Cert;
  try {
    leaf = parseCertificate(bundle.certDer);
  } catch (e) {
    return fail("malformed-bundle", (e as Error).message);
  }

  // The issuer's OWN validity window is deliberately not checked. It is pinned
  // in this binary rather than supplied by the download, so an expiry there is
  // our clock disagreeing with our own build — not evidence about the artefact.
  let issuedByAnchor: boolean;
  try {
    issuedByAnchor = await ecdsaVerify(
      issuer.spki,
      issuer.curve,
      hashForSignatureAlgorithm(leaf.signatureAlgorithm),
      leaf.signature,
      leaf.tbs,
    );
  } catch (e) {
    return fail("malformed-bundle", (e as Error).message);
  }
  if (!issuedByAnchor) {
    return fail("untrusted-issuer", "signing certificate was not issued by the pinned authority");
  }

  // WHEN was this signed? Not "what time is it now".
  //
  // A Fulcio signing certificate lives ten minutes. Judging its validity window
  // by the wall clock therefore refuses every release older than ten minutes —
  // which is what shipped, and it made `self-update` refuse every signed
  // release deterministically, for every user, with a message blaming a
  // certificate-authority rotation that had not happened.
  //
  // The signature's age is not the reader's business to guess. Rekor
  // counter-signs each log entry with a Signed Entry Timestamp covering
  // `integratedTime`, so a verified SET is a statement from the log, under its
  // own key, about when it saw this signature. That is the instant the
  // certificate window has to contain.
  //
  // `now` is still a parameter and still used — for the SET itself, below, and
  // by callers that pin it in tests. It is simply no longer the thing a
  // ten-minute certificate is measured against.
  const signedAt = await verifiedSigningTime(bundle, anchor);
  if (signedAt === null) {
    return fail(
      "untrusted-timestamp",
      bundle.tlog === undefined
        ? "bundle carries no transparency-log entry, so there is no signed " +
          "statement of when it was signed"
        : "the transparency log's signed entry timestamp did not verify against " +
          "the pinned log key",
    );
  }

  // Generously bounded, because the alternative failure is worse than the
  // attack: a user whose clock is a few hours slow must not be told their
  // release is forged. A day of tolerance cannot be reached by skew and still
  // rejects a nonsense timestamp.
  const SKEW_TOLERANCE_MS = 86_400_000;
  if (signedAt.getTime() > now.getTime() + SKEW_TOLERANCE_MS) {
    return fail(
      "untrusted-timestamp",
      `the log records a signing time in the future (${signedAt.toISOString()} ` +
        `against ${now.toISOString()})`,
    );
  }

  if (signedAt < leaf.notBefore || signedAt > leaf.notAfter) {
    return fail(
      "certificate-expired",
      `signing certificate is valid ${leaf.notBefore.toISOString()} to ` +
        `${leaf.notAfter.toISOString()}, but the log recorded the signature at ` +
        signedAt.toISOString(),
    );
  }

  if (!leaf.sanUris.includes(anchor.expectedSanUri)) {
    return fail(
      "identity-mismatch",
      `certificate names ${leaf.sanUris.join(", ") || "no identity"}; expected ` +
        anchor.expectedSanUri,
    );
  }
  if (leaf.oidcIssuer !== anchor.expectedOidcIssuer) {
    return fail(
      "identity-mismatch",
      `certificate's OIDC issuer is ${leaf.oidcIssuer ?? "absent"}; expected ` +
        anchor.expectedOidcIssuer,
    );
  }

  // Sigstore pairs the DSSE hash with the signing key's curve.
  const dsseHash = leaf.curve.name === "P-256" ? "SHA-256" : "SHA-384";
  const message = preAuthEncoding(bundle.payloadType, bundle.payload);
  let anyValid = false;
  for (const sig of bundle.signatures) {
    if (await ecdsaVerify(leaf.spki, leaf.curve, dsseHash, sig, message)) {
      anyValid = true;
      break;
    }
  }
  if (!anyValid) {
    return fail("signature-invalid", "no signature in the envelope verifies under the certificate");
  }

  // Only now is the payload trustworthy enough to read. Parsing it earlier
  // would let an unauthenticated statement steer the check that authenticates it.
  let subjects: ReturnType<typeof parseSubjects>;
  try {
    subjects = parseSubjects(bundle.payload);
  } catch (e) {
    return fail("malformed-bundle", (e as Error).message);
  }
  if (!subjects.some((s) => s.sha256 === artifactSha256)) {
    return fail(
      "digest-mismatch",
      `signed statement covers ${subjects.map((s) => s.sha256).join(", ")}; ` +
        `these bytes are ${artifactSha256}`,
    );
  }

  return { ok: true, identity: anchor.expectedSanUri };
}

export async function verifyArtifact(input: {
  /** The bundle document as published, or `null` when the release carries none. */
  readonly bundleJson: string | null;
  /** Lowercase hex SHA-256 of the bytes about to be installed. */
  readonly artifactSha256: string;
  /** Injected so a committed fixture stays replayable — Fulcio leaves live minutes. */
  readonly now: Date;
  readonly anchor: TrustAnchor;
}): Promise<VerificationOutcome> {
  const { bundleJson, artifactSha256, now, anchor } = input;

  if (bundleJson === null || bundleJson.trim() === "") {
    return fail("no-bundle", "the release published no signature bundle");
  }

  let bundles: SigstoreBundle[];
  try {
    bundles = parseBundles(bundleJson);
  } catch (e) {
    return fail("malformed-bundle", (e as Error).message);
  }

  let issuer: X509Cert;
  try {
    issuer = parseCertificate(anchor.issuerCertDer);
  } catch (e) {
    // The anchor is ours, not the attacker's — an unreadable one is a defect in
    // this binary, and saying so beats blaming the download.
    return fail(
      "malformed-bundle",
      `pinned issuer certificate is unreadable: ${(e as Error).message}`,
    );
  }

  let worst: VerificationOutcome = fail("malformed-bundle", "no bundle in the document was usable");
  for (const bundle of bundles) {
    const outcome = await verifyOne(bundle, artifactSha256, now, anchor, issuer);
    if (outcome.ok) return outcome;
    if (!worst.ok && PROGRESS[outcome.reason] >= PROGRESS[worst.reason]) worst = outcome;
  }
  return worst;
}
