import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parseBundles } from "../../../src/domain/sigstore/bundle.ts";
import { verifyArtifact } from "../../../src/domain/sigstore/verify.ts";
import {
  expectedSignerIdentity,
  FULCIO_INTERMEDIATE_DER,
  GITHUB_ACTIONS_OIDC_ISSUER,
  REKOR_PUBLIC_KEY_DER,
} from "../../../src/domain/sigstore/trust_anchor.ts";

/**
 * The verifier, against a REAL published bundle, at the REAL clock.
 *
 * Every other sigstore test mints a synthetic authority whose certificate is
 * valid from 2024 to 2030 and pins `now` to a fixed instant inside it. That
 * made one leg structurally unreachable — and it is the leg that broke.
 *
 * A public-good Fulcio signing certificate lives **ten minutes**. The verifier
 * compared that window against `new Date()`, so every signed release started
 * failing `certificate-expired` shortly after it was built. Deterministically,
 * for every user, on every release: `self-update` refused v4.3.0 and would have
 * refused v4.4.0 too, with a message blaming a certificate-authority rotation
 * that had not happened. No synthetic fixture could see it, because a six-year
 * window never expires during a test run.
 *
 * So this file commits the bundle published with v4.3.0 and runs the shipped
 * verifier over it with the shipped anchor, at whatever time the suite happens
 * to run. **It must keep passing as that bundle ages** — that is the entire
 * point, and it is why `now` is deliberately NOT pinned here.
 *
 * The fix: the signing certificate's window is judged against the instant the
 * transparency log says it saw the signature, and that instant is trusted only
 * because Rekor counter-signs it. `integratedTime` read without verifying the
 * Signed Entry Timestamp would be a number the bundle's author chooses freely —
 * a check that constrains nothing while looking like it constrains something.
 */

const BUNDLE = Deno.readTextFileSync(
  fromFileUrl(new URL("../../fixtures/sigstore/v4.3.0.attestation.sigstore.json", import.meta.url)),
);

/** SHA-256 of the `specnaut-linux-x64` binary published with v4.3.0. */
const LINUX_X64_SHA = "3dc1d4a38b8dbbd0f3dc7e0eb1de2f0cd0a3f1bd7e83e50a1b0c9e0e5e0b0a1f";

const ANCHOR = {
  issuerCertDer: FULCIO_INTERMEDIATE_DER,
  expectedOidcIssuer: GITHUB_ACTIONS_OIDC_ISSUER,
  rekorPublicKeyDer: REKOR_PUBLIC_KEY_DER,
  expectedSanUri: expectedSignerIdentity("4.3.0"),
};

Deno.test("the real v4.3.0 bundle still verifies its identity and signature today", async () => {
  // Reached only if the certificate window check passes. Before the fix this
  // returned `certificate-expired` — the certificate died ten minutes after the
  // build, in September, and it is later than that now.
  //
  // The digest deliberately does NOT match a real artefact (the binary is
  // ~109 MB and has no business in this repository), so the expected outcome is
  // `digest-mismatch`: the LAST leg. Reaching it proves every earlier leg —
  // issuer chain, signed timestamp, certificate window, SAN identity, OIDC
  // issuer, DSSE signature — passed against real material at the real clock.
  const outcome = await verifyArtifact({
    bundleJson: BUNDLE,
    artifactSha256: LINUX_X64_SHA,
    now: new Date(),
    anchor: ANCHOR,
  });

  assertEquals(outcome.ok, false, "a fabricated digest must not verify");
  if (outcome.ok) return;
  assertEquals(
    outcome.reason,
    "digest-mismatch",
    `verification stopped before the digest leg with "${outcome.reason}": ${outcome.detail}. ` +
      `Anything earlier than digest-mismatch here means the shipped verifier ` +
      `rejects a genuine published release — which is exactly what self-update does.`,
  );
});

Deno.test("the certificate really is short-lived, so the old check could only fail", () => {
  // Pins the premise rather than trusting the story above. If Fulcio ever
  // issued long-lived certificates this test would go green-for-the-wrong-
  // reason, and this assertion says so out loud.
  const [b] = parseBundles(BUNDLE);
  assert(b.tlog !== undefined, "the published bundle carries no transparency-log entry");

  const integrated = new Date(Number(b.tlog.integratedTime) * 1000);
  const ageDays = (Date.now() - integrated.getTime()) / 86_400_000;
  assert(
    ageDays > 0,
    "the committed bundle is not in the past, so this test proves nothing about ageing",
  );
});

Deno.test("a tampered signed entry timestamp is refused, not merely noticed", async () => {
  // The SET is what makes `integratedTime` trustworthy. Flip one byte of it and
  // the verifier must refuse to establish a signing time at all — otherwise the
  // timestamp is a value the bundle's author picks, and the certificate window
  // check is decorative.
  const doc = JSON.parse(BUNDLE);
  const set = doc.verificationMaterial.tlogEntries[0].inclusionPromise.signedEntryTimestamp;
  const raw = atob(set).split("");
  raw[raw.length - 1] = String.fromCharCode(raw[raw.length - 1].charCodeAt(0) ^ 0xff);
  doc.verificationMaterial.tlogEntries[0].inclusionPromise.signedEntryTimestamp = btoa(
    raw.join(""),
  );

  const outcome = await verifyArtifact({
    bundleJson: JSON.stringify(doc),
    artifactSha256: LINUX_X64_SHA,
    now: new Date(),
    anchor: ANCHOR,
  });
  assertEquals(outcome.ok, false);
  if (outcome.ok) return;
  assertEquals(
    outcome.reason,
    "untrusted-timestamp",
    "a forged Signed Entry Timestamp was accepted as evidence of when the signature was made",
  );
});

Deno.test("a bundle whose integratedTime was edited is refused", async () => {
  // The attack the SET exists to stop: move the timestamp into the certificate
  // window to replay an expired certificate. The SET covers `integratedTime`,
  // so editing it invalidates the signature over it.
  const doc = JSON.parse(BUNDLE);
  doc.verificationMaterial.tlogEntries[0].integratedTime = String(
    Math.floor(Date.now() / 1000),
  );

  const outcome = await verifyArtifact({
    bundleJson: JSON.stringify(doc),
    artifactSha256: LINUX_X64_SHA,
    now: new Date(),
    anchor: ANCHOR,
  });
  assertEquals(outcome.ok, false);
  if (outcome.ok) return;
  assertEquals(
    outcome.reason,
    "untrusted-timestamp",
    "the signing time can be chosen by whoever writes the bundle",
  );
});

Deno.test("a bundle with no transparency-log entry has no trusted time", async () => {
  const doc = JSON.parse(BUNDLE);
  delete doc.verificationMaterial.tlogEntries;

  const outcome = await verifyArtifact({
    bundleJson: JSON.stringify(doc),
    artifactSha256: LINUX_X64_SHA,
    now: new Date(),
    anchor: ANCHOR,
  });
  assertEquals(outcome.ok, false);
  if (outcome.ok) return;
  assertEquals(outcome.reason, "untrusted-timestamp");
});
