/**
 * Just enough X.509 to answer three questions about a Fulcio certificate:
 * who it says signed, whether a trusted certificate signed *it*, and which
 * public key verifies the DSSE envelope.
 *
 * It is not a general certificate library and must never grow into one. It
 * does not build paths, does not read CRLs or OCSP, and does not enforce name
 * constraints — the trust model in `verify.ts` is a single pinned issuer, so
 * there is no path to build. Anything this file does not check is stated in
 * that file's own comment rather than left for a reader to infer.
 */

import {
  children,
  contentOf,
  contextConstructed,
  contextPrimitive,
  DerError,
  derTimeToDate,
  expectTag,
  oidToString,
  readTlv,
  TAG,
  type Tlv,
  tlvBytes,
} from "./der.ts";

export const OID = {
  EC_PUBLIC_KEY: "1.2.840.10045.2.1",
  P256: "1.2.840.10045.3.1.7",
  P384: "1.3.132.0.34",
  ECDSA_SHA256: "1.2.840.10045.4.3.2",
  ECDSA_SHA384: "1.2.840.10045.4.3.3",
  SUBJECT_ALT_NAME: "2.5.29.17",
  /** Fulcio's original OIDC issuer extension: raw UTF-8, not DER-wrapped. */
  FULCIO_ISSUER_V1: "1.3.6.1.4.1.57264.1.1",
  /** Fulcio's v2 issuer extension: a DER-encoded UTF8String. */
  FULCIO_ISSUER_V2: "1.3.6.1.4.1.57264.1.8",
} as const;

export type EcCurve = { name: "P-256" | "P-384"; coordBytes: 32 | 48 };

export type X509Cert = {
  /** DER of `tbsCertificate`, header included — exactly what the issuer signed. */
  readonly tbs: Uint8Array;
  /** DER of `subjectPublicKeyInfo` — what `crypto.subtle.importKey("spki", …)` takes. */
  readonly spki: Uint8Array;
  readonly curve: EcCurve;
  /** The algorithm the ISSUER used over {@link tbs}. */
  readonly signatureAlgorithm: string;
  /** The issuer's signature over {@link tbs}, still DER-encoded. */
  readonly signature: Uint8Array;
  readonly notBefore: Date;
  readonly notAfter: Date;
  /** Every `uniformResourceIdentifier` in the SAN extension. */
  readonly sanUris: readonly string[];
  /** The OIDC issuer Fulcio recorded, or `null` when the certificate carries none. */
  readonly oidcIssuer: string | null;
};

function curveFor(oid: string): EcCurve {
  switch (oid) {
    case OID.P256:
      return { name: "P-256", coordBytes: 32 };
    case OID.P384:
      return { name: "P-384", coordBytes: 48 };
    default:
      throw new DerError(`unsupported curve ${oid} — only P-256 and P-384 appear in this chain`);
  }
}

/** The hash a given ECDSA signature algorithm pairs with. */
export function hashForSignatureAlgorithm(oid: string): "SHA-256" | "SHA-384" {
  switch (oid) {
    case OID.ECDSA_SHA256:
      return "SHA-256";
    case OID.ECDSA_SHA384:
      return "SHA-384";
    default:
      throw new DerError(`unsupported signature algorithm ${oid}`);
  }
}

function algorithmOid(buf: Uint8Array, algId: Tlv): string {
  expectTag(algId, TAG.SEQUENCE, "AlgorithmIdentifier");
  const parts = children(buf, algId);
  if (parts.length === 0) throw new DerError("empty AlgorithmIdentifier");
  return oidToString(buf, parts[0]);
}

/** A BIT STRING's payload, minus the leading unused-bits count. */
function bitStringBytes(buf: Uint8Array, tlv: Tlv): Uint8Array {
  expectTag(tlv, TAG.BIT_STRING, "BIT STRING");
  const raw = contentOf(buf, tlv);
  if (raw.length === 0) throw new DerError("empty BIT STRING");
  if (raw[0] !== 0) {
    throw new DerError(`BIT STRING has ${raw[0]} unused bits; expected a whole number of bytes`);
  }
  return raw.subarray(1);
}

export function parseCertificate(der: Uint8Array): X509Cert {
  const cert = expectTag(readTlv(der, 0), TAG.SEQUENCE, "Certificate");
  const [tbsTlv, algIdTlv, sigTlv, ...rest] = children(der, cert);
  if (rest.length > 0) throw new DerError("Certificate has unexpected trailing fields");
  if (!tbsTlv || !algIdTlv || !sigTlv) {
    throw new DerError("Certificate is missing a top-level field");
  }

  expectTag(tbsTlv, TAG.SEQUENCE, "tbsCertificate");
  const fields = children(der, tbsTlv);

  // `version [0] EXPLICIT` is optional and defaults to v1. Fulcio issues v3, so
  // it is always present — but keying the field offsets on its presence rather
  // than assuming it keeps this readable against any conforming certificate.
  let i = 0;
  if (fields[i]?.tag === contextConstructed(0)) i++;
  i++; // serialNumber
  const innerAlg = fields[i++];
  i++; // issuer
  const validity = fields[i++];
  i++; // subject
  const spkiTlv = fields[i++];
  if (!innerAlg || !validity || !spkiTlv) throw new DerError("tbsCertificate is truncated");

  // RFC 5280 requires the inner and outer algorithm identifiers to agree. When
  // they disagree, one of them describes a signature nobody verified.
  const signatureAlgorithm = algorithmOid(der, algIdTlv);
  if (algorithmOid(der, innerAlg) !== signatureAlgorithm) {
    throw new DerError("tbsCertificate.signature disagrees with Certificate.signatureAlgorithm");
  }

  const [notBeforeTlv, notAfterTlv] = children(der, expectTag(validity, TAG.SEQUENCE, "Validity"));
  if (!notBeforeTlv || !notAfterTlv) throw new DerError("Validity is missing a bound");

  const spkiParts = children(der, expectTag(spkiTlv, TAG.SEQUENCE, "SubjectPublicKeyInfo"));
  const spkiAlg = children(der, expectTag(spkiParts[0], TAG.SEQUENCE, "SPKI algorithm"));
  if (oidToString(der, spkiAlg[0]) !== OID.EC_PUBLIC_KEY) {
    throw new DerError("subject public key is not an EC key");
  }
  if (!spkiAlg[1]) throw new DerError("EC public key carries no curve parameter");

  const extensions = fields.slice(i).find((f) => f.tag === contextConstructed(3));

  return {
    tbs: tlvBytes(der, tbsTlv),
    spki: tlvBytes(der, spkiTlv),
    curve: curveFor(oidToString(der, spkiAlg[1])),
    signatureAlgorithm,
    signature: bitStringBytes(der, sigTlv),
    notBefore: derTimeToDate(der, notBeforeTlv),
    notAfter: derTimeToDate(der, notAfterTlv),
    sanUris: extensions ? subjectAltNameUris(der, extensions) : [],
    oidcIssuer: extensions ? oidcIssuer(der, extensions) : null,
  };
}

function extensionValues(der: Uint8Array, extensionsTlv: Tlv): Map<string, Uint8Array> {
  const seq = children(der, extensionsTlv)[0];
  if (!seq) throw new DerError("extensions block is empty");
  const out = new Map<string, Uint8Array>();
  for (const ext of children(der, expectTag(seq, TAG.SEQUENCE, "Extensions"))) {
    const parts = children(der, expectTag(ext, TAG.SEQUENCE, "Extension"));
    const oid = oidToString(der, parts[0]);
    // `critical` is DEFAULT FALSE, so it may or may not be encoded. The value
    // is whichever OCTET STRING sits last.
    const value = parts[parts.length - 1];
    expectTag(value, TAG.OCTET_STRING, `extension ${oid} value`);
    // A repeated extension OID is forbidden by RFC 5280 and would let a second
    // copy shadow the one a reader checked.
    if (out.has(oid)) throw new DerError(`extension ${oid} appears more than once`);
    out.set(oid, contentOf(der, value));
  }
  return out;
}

function subjectAltNameUris(der: Uint8Array, extensionsTlv: Tlv): string[] {
  const value = extensionValues(der, extensionsTlv).get(OID.SUBJECT_ALT_NAME);
  if (!value) return [];
  const names = expectTag(readTlv(value, 0), TAG.SEQUENCE, "GeneralNames");
  const uris: string[] = [];
  for (const name of children(value, names)) {
    // `uniformResourceIdentifier [6] IMPLICIT IA5String`.
    if (name.tag !== contextPrimitive(6)) continue;
    uris.push(new TextDecoder().decode(contentOf(value, name)));
  }
  return uris;
}

function oidcIssuer(der: Uint8Array, extensionsTlv: Tlv): string | null {
  const values = extensionValues(der, extensionsTlv);
  // v2 is a DER-encoded UTF8String; v1 was the raw bytes. Fulcio still emits
  // both, and preferring v2 matches what cosign reads.
  const v2 = values.get(OID.FULCIO_ISSUER_V2);
  if (v2) {
    const tlv = expectTag(readTlv(v2, 0), TAG.UTF8_STRING, "OIDC issuer");
    return new TextDecoder().decode(contentOf(v2, tlv));
  }
  const v1 = values.get(OID.FULCIO_ISSUER_V1);
  return v1 ? new TextDecoder().decode(v1) : null;
}
