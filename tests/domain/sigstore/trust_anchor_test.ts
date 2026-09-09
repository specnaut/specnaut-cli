import { assert, assertEquals } from "@std/assert";
import {
  ATTESTATION_ASSET_NAME,
  expectedSignerIdentity,
  FULCIO_INTERMEDIATE_DER,
  FULCIO_ROOT_DER,
  GITHUB_ACTIONS_OIDC_ISSUER,
} from "../../../src/domain/sigstore/trust_anchor.ts";
import { hashForSignatureAlgorithm, parseCertificate } from "../../../src/domain/sigstore/x509.ts";
import { derEcdsaToP1363 } from "../../../src/domain/sigstore/der.ts";
import { RELEASE_REPO } from "../../../src/domain/release.ts";

/**
 * These run against the REAL, production Fulcio certificates.
 *
 * That is the point. Every other test in this directory uses a synthetic
 * authority, which proves the verifier is self-consistent and proves nothing
 * about whether it can read what Sigstore actually emits. A parser that only
 * ever meets its own encoder is a parser nobody has tested.
 */

Deno.test("the pinned intermediate was issued by the pinned root", async () => {
  // The check that makes the pin trustworthy. The root came from two
  // independent sources that agree byte for byte; the intermediate came from
  // one, and this is what ties it to the other. Pinning a certificate nobody
  // verified is how a supply-chain control ends up anchored on a download.
  const root = parseCertificate(FULCIO_ROOT_DER);
  const intermediate = parseCertificate(FULCIO_INTERMEDIATE_DER);

  const key = await crypto.subtle.importKey(
    "spki",
    root.spki as unknown as BufferSource,
    { name: "ECDSA", namedCurve: root.curve.name },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: hashForSignatureAlgorithm(intermediate.signatureAlgorithm) },
    key,
    derEcdsaToP1363(intermediate.signature, root.curve.coordBytes) as unknown as BufferSource,
    intermediate.tbs as unknown as BufferSource,
  );
  assert(ok, "the pinned intermediate is NOT signed by the pinned root — one of them is wrong");
});

Deno.test("the pinned chain is the public-good Sigstore chain, on the curve it uses", () => {
  // A silent swap to a different authority would still verify against itself.
  // These are the properties recorded when the pins were taken.
  const root = parseCertificate(FULCIO_ROOT_DER);
  const intermediate = parseCertificate(FULCIO_INTERMEDIATE_DER);
  assertEquals(root.curve.name, "P-384");
  assertEquals(intermediate.curve.name, "P-384");
  assertEquals(root.notAfter.toISOString(), "2031-10-05T13:56:58.000Z");
  assertEquals(intermediate.notAfter.toISOString(), "2031-10-05T13:56:58.000Z");
});

Deno.test("the pinned anchors outlive any release that would use them", () => {
  // Not a security property — a canary. When this fires, Sigstore has rotated
  // and every installed binary is about to start failing self-update; the fix
  // is a patch release with new pins, not a relaxed check.
  const intermediate = parseCertificate(FULCIO_INTERMEDIATE_DER);
  assert(
    intermediate.notAfter.getTime() > Date.now(),
    "the pinned Fulcio intermediate has EXPIRED — self-update will refuse every " +
      "release until this binary ships new pins",
  );
});

Deno.test("the signer identity names this repository's release workflow and the exact tag", () => {
  const identity = expectedSignerIdentity("4.3.0");
  assertEquals(
    identity,
    `https://github.com/${RELEASE_REPO}/.github/workflows/release.yml@refs/tags/v4.3.0`,
  );
  // The tag is inside the identity on purpose: a bundle lifted from another
  // release of this same repository must fail, and it can only fail here.
  assert(expectedSignerIdentity("4.3.1") !== identity);
});

Deno.test("the attestation asset name cannot be swept up by the checksum loop", () => {
  // release.yml computes a `.sha256` for every `dist/specnaut-*`. A bundle
  // named with a hyphen would match, gain a sidecar, and break the asset count.
  assert(
    !ATTESTATION_ASSET_NAME.startsWith("specnaut-"),
    `${ATTESTATION_ASSET_NAME} matches the release workflow's specnaut-* checksum glob`,
  );
  assertEquals(GITHUB_ACTIONS_OIDC_ISSUER, "https://token.actions.githubusercontent.com");
});
