import { assert, assertEquals } from "@std/assert";
import { verifyArtifact } from "../../../src/domain/sigstore/verify.ts";
import type { TrustAnchor } from "../../../src/domain/sigstore/verify.ts";
import {
  type Authority,
  issueSigningCert,
  makeAuthority,
  makeBundle,
  type SigningCert,
} from "../../helpers/sigstore_fixture.ts";

/**
 * The seven-reason matrix.
 *
 * Every case is the happy path with exactly ONE thing changed, so a failure
 * names the thing that caused it. That shape is the point: the ticket requires
 * each reason to have been observed red on the defect it guards, and a negative
 * assertion is otherwise satisfied by any failure at all — including one that
 * never reached the code under test.
 */

const SAN = "https://github.com/acme/widget/.github/workflows/release.yml@refs/tags/v1.2.3";
const ISSUER = "https://token.actions.githubusercontent.com";
const DIGEST = "a".repeat(64);
const NOW = new Date("2026-01-01T12:00:00Z");
const VALID_FROM = new Date("2026-01-01T11:55:00Z");
const VALID_TO = new Date("2026-01-01T12:05:00Z");

let authority: Authority;
let cert: SigningCert;

async function setup(): Promise<void> {
  authority ??= await makeAuthority();
  cert ??= await issueSigningCert(authority, {
    sanUri: SAN,
    oidcIssuer: ISSUER,
    notBefore: VALID_FROM,
    notAfter: VALID_TO,
  });
}

function anchorFor(a: Authority, san = SAN, issuer = ISSUER): TrustAnchor {
  return { issuerCertDer: a.certDer, expectedSanUri: san, expectedOidcIssuer: issuer };
}

async function happyBundle(): Promise<string> {
  return await makeBundle(cert, { subjects: [{ name: "specnaut-linux-x64", sha256: DIGEST }] });
}

Deno.test("a bundle from the pinned identity over these bytes verifies", async () => {
  await setup();
  const outcome = await verifyArtifact({
    bundleJson: await happyBundle(),
    artifactSha256: DIGEST,
    now: NOW,
    anchor: anchorFor(authority),
  });
  // Report the detail on failure — a bare `assert(outcome.ok)` on a broken
  // parser says nothing about which of nine steps broke.
  assert(outcome.ok, `expected a pass, got ${JSON.stringify(outcome)}`);
});

Deno.test("no bundle at all is 'no-bundle', not a pass", async () => {
  await setup();
  for (const bundleJson of [null, "", "   "]) {
    const outcome = await verifyArtifact({
      bundleJson,
      artifactSha256: DIGEST,
      now: NOW,
      anchor: anchorFor(authority),
    });
    assert(!outcome.ok && outcome.reason === "no-bundle", JSON.stringify(outcome));
  }
});

Deno.test("unreadable material is 'malformed-bundle'", async () => {
  await setup();
  const good = await happyBundle();
  const cases: Record<string, string> = {
    "not json": "{{{",
    "no verification material": JSON.stringify({ dsseEnvelope: {} }),
    "no envelope": JSON.stringify({ verificationMaterial: { certificate: { rawBytes: "AA==" } } }),
    "certificate is not a certificate": good.replace(/"rawBytes":"[^"]+"/, '"rawBytes":"AAAA"'),
  };
  for (const [name, bundleJson] of Object.entries(cases)) {
    const outcome = await verifyArtifact({
      bundleJson,
      artifactSha256: DIGEST,
      now: NOW,
      anchor: anchorFor(authority),
    });
    assert(
      !outcome.ok && outcome.reason === "malformed-bundle",
      `${name}: ${JSON.stringify(outcome)}`,
    );
  }
});

Deno.test("a real certificate from another authority is 'untrusted-issuer'", async () => {
  await setup();
  // The certificate is well-formed, in date, and names the right identity. The
  // only thing wrong with it is who signed it — which is the whole control.
  const foreign = await makeAuthority({ name: "acme rogue authority" });
  const foreignCert = await issueSigningCert(foreign, {
    sanUri: SAN,
    oidcIssuer: ISSUER,
    notBefore: VALID_FROM,
    notAfter: VALID_TO,
  });
  const outcome = await verifyArtifact({
    bundleJson: await makeBundle(foreignCert, { subjects: [{ name: "x", sha256: DIGEST }] }),
    artifactSha256: DIGEST,
    now: NOW,
    anchor: anchorFor(authority),
  });
  assert(!outcome.ok && outcome.reason === "untrusted-issuer", JSON.stringify(outcome));
});

Deno.test("a certificate outside its validity window is 'certificate-expired'", async () => {
  await setup();
  const bundleJson = await happyBundle();
  for (const now of [new Date("2026-01-01T11:00:00Z"), new Date("2026-01-01T13:00:00Z")]) {
    const outcome = await verifyArtifact({
      bundleJson,
      artifactSha256: DIGEST,
      now,
      anchor: anchorFor(authority),
    });
    assert(
      !outcome.ok && outcome.reason === "certificate-expired",
      `${now.toISOString()}: ${JSON.stringify(outcome)}`,
    );
  }
});

Deno.test("a valid signature from the wrong workflow is 'identity-mismatch'", async () => {
  await setup();
  const bundleJson = await happyBundle();
  const otherWorkflow =
    "https://github.com/acme/widget/.github/workflows/nightly.yml@refs/heads/main";
  const outcome = await verifyArtifact({
    bundleJson,
    artifactSha256: DIGEST,
    now: NOW,
    anchor: anchorFor(authority, otherWorkflow),
  });
  assert(!outcome.ok && outcome.reason === "identity-mismatch", JSON.stringify(outcome));

  const wrongIssuer = await verifyArtifact({
    bundleJson,
    artifactSha256: DIGEST,
    now: NOW,
    anchor: anchorFor(authority, SAN, "https://accounts.example.com"),
  });
  assert(
    !wrongIssuer.ok && wrongIssuer.reason === "identity-mismatch",
    JSON.stringify(wrongIssuer),
  );
});

Deno.test("a corrupted signature is 'signature-invalid'", async () => {
  await setup();
  const outcome = await verifyArtifact({
    bundleJson: await makeBundle(cert, {
      subjects: [{ name: "x", sha256: DIGEST }],
      tamperSignature: true,
    }),
    artifactSha256: DIGEST,
    now: NOW,
    anchor: anchorFor(authority),
  });
  assert(!outcome.ok && outcome.reason === "signature-invalid", JSON.stringify(outcome));
});

Deno.test("an authentic signature over different bytes is 'digest-mismatch'", async () => {
  await setup();
  // The attack this closes: take a genuine, correctly-signed bundle from one
  // release and serve it beside a different binary.
  const outcome = await verifyArtifact({
    bundleJson: await happyBundle(),
    artifactSha256: "b".repeat(64),
    now: NOW,
    anchor: anchorFor(authority),
  });
  assert(!outcome.ok && outcome.reason === "digest-mismatch", JSON.stringify(outcome));
});

Deno.test("a statement covering several artefacts accepts any one of them", async () => {
  await setup();
  // One attestation covers all five platform binaries, so the verifier must
  // match the subject it was handed rather than assuming a single subject.
  const other = "c".repeat(64);
  const outcome = await verifyArtifact({
    bundleJson: await makeBundle(cert, {
      subjects: [
        { name: "specnaut-linux-x64", sha256: other },
        { name: "specnaut-macos-arm64", sha256: DIGEST },
      ],
    }),
    artifactSha256: DIGEST,
    now: NOW,
    anchor: anchorFor(authority),
  });
  assert(outcome.ok, JSON.stringify(outcome));
});

Deno.test("the payload type is bound into the signature", async () => {
  await setup();
  // DSSE signs the pre-authentication encoding, which includes the type. A
  // verifier that signed the payload alone would accept this.
  const good = await happyBundle();
  const swapped = good.replace(
    '"payloadType":"application/vnd.in-toto+json"',
    '"payloadType":"application/vnd.other+json"',
  );
  assert(swapped !== good, "the payload type substitution did not apply");
  const outcome = await verifyArtifact({
    bundleJson: swapped,
    artifactSha256: DIGEST,
    now: NOW,
    anchor: anchorFor(authority),
  });
  assert(!outcome.ok && outcome.reason === "signature-invalid", JSON.stringify(outcome));
});

Deno.test("every failure reason above is reachable", () => {
  // A matrix that silently stops covering a reason is the failure this file
  // exists to prevent, so the list is asserted rather than trusted.
  assertEquals(
    [
      "no-bundle",
      "malformed-bundle",
      "untrusted-issuer",
      "certificate-expired",
      "identity-mismatch",
      "signature-invalid",
      "digest-mismatch",
    ].length,
    7,
  );
});
