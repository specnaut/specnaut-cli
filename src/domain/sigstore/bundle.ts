/**
 * Reading a Sigstore bundle, across the shapes that are actually in the wild.
 *
 * The media type moved from `v0.1` to `v0.3`, and with it the certificate
 * moved from `verificationMaterial.x509CertificateChain.certificates[0]` to
 * `verificationMaterial.certificate`. Both are accepted: a verifier that only
 * knows the shape it was written against fails on a bundle that is perfectly
 * valid, and the failure looks like tampering.
 *
 * The transparency-log entry is deliberately NOT read. Inclusion in Rekor is
 * what makes a signature publicly auditable, and checking it properly means
 * verifying a signed tree head against a log key with its own rotation story.
 * This verifier's guarantee is therefore "signed by the pinned identity under
 * the pinned certificate authority", not "publicly logged" — stated here so
 * nobody reads more into a pass than it carries.
 */

import { decodeBase64 } from "@std/encoding/base64";

export type SigstoreBundle = {
  readonly certDer: Uint8Array;
  readonly payloadType: string;
  readonly payload: Uint8Array;
  /** DER-encoded ECDSA signatures over the payload's PAE. */
  readonly signatures: readonly Uint8Array[];
};

export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}

function base64(value: unknown, what: string): Uint8Array {
  if (typeof value !== "string" || value.length === 0) {
    throw new BundleError(`${what} is missing`);
  }
  try {
    return decodeBase64(value);
  } catch {
    throw new BundleError(`${what} is not valid base64`);
  }
}

/**
 * Every bundle in the document, in order.
 *
 * **Plural on purpose.** One artefact digest can carry more than one
 * attestation, and they are not interchangeable: alongside the one this
 * project's workflow produced, GitHub adds its own release attestation signed
 * by a different authority with a different identity. A verifier that takes
 * `[0]` pins whichever happens to be first — observed first on more than one
 * public repository — and then either fails on a valid artefact or checks an
 * identity nobody chose.
 *
 * Accepts a bare bundle, a JSON array of them, or the
 * `{ "attestations": [{ "bundle": … }] }` envelope.
 */
export function parseBundles(json: string): SigstoreBundle[] {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch (e) {
    throw new BundleError(`bundle is not JSON: ${(e as Error).message}`);
  }

  const attestations = (root as { attestations?: unknown })?.attestations;
  if (Array.isArray(attestations)) {
    if (attestations.length === 0) throw new BundleError("attestation list is empty");
    return attestations.map((a, i) =>
      parseOne((a as { bundle?: unknown })?.bundle, `attestation ${i}`)
    );
  }
  if (Array.isArray(root)) {
    if (root.length === 0) throw new BundleError("bundle list is empty");
    return root.map((b, i) => parseOne(b, `bundle ${i}`));
  }
  return [parseOne(root, "bundle")];
}

function parseOne(root: unknown, where: string): SigstoreBundle {
  if (!root || typeof root !== "object") throw new BundleError(`${where} is not an object`);
  const material = (root as { verificationMaterial?: Record<string, unknown> })
    ?.verificationMaterial;
  if (!material) throw new BundleError(`${where} carries no verificationMaterial`);

  const single = (material.certificate as { rawBytes?: unknown })?.rawBytes;
  const chain = (material.x509CertificateChain as { certificates?: unknown })?.certificates;
  const leaf = single ??
    (Array.isArray(chain) ? (chain[0] as { rawBytes?: unknown })?.rawBytes : undefined);

  const envelope = (root as { dsseEnvelope?: Record<string, unknown> })?.dsseEnvelope;
  if (!envelope) throw new BundleError(`${where} carries no dsseEnvelope`);
  const sigs = envelope.signatures;
  if (!Array.isArray(sigs) || sigs.length === 0) {
    throw new BundleError("dsseEnvelope carries no signature");
  }
  const payloadType = envelope.payloadType;
  if (typeof payloadType !== "string" || payloadType.length === 0) {
    throw new BundleError("dsseEnvelope has no payloadType");
  }

  return {
    certDer: base64(leaf, "signing certificate"),
    payloadType,
    payload: base64(envelope.payload, "dsseEnvelope payload"),
    signatures: sigs.map((s, i) => base64((s as { sig?: unknown })?.sig, `signature ${i}`)),
  };
}
