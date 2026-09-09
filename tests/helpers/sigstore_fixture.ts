/**
 * A synthetic certificate authority, for tests only.
 *
 * The verifier's failure paths — a foreign issuer, a wrong identity, a tampered
 * digest — cannot be exercised with a real Sigstore bundle: real ones are all
 * valid, and mutating one by hand changes two things at once (edit a SAN and the
 * certificate signature breaks too, so an identity test passes for the wrong
 * reason). Minting our own certificates is the only way each reason is reached
 * on its own.
 *
 * It is also why this file contains a DER **encoder** while `src/` has only a
 * reader: production never builds a certificate, and shipping an encoder it
 * does not use would be surface for nothing.
 *
 * Placeholder identities only (`acme`, `example.com`) — a fixture is a document
 * that gets copied, and a real project's slug in one is a leak.
 */

import { encodeBase64 } from "@std/encoding/base64";

// ---------------------------------------------------------------- DER writing

function derLength(n: number): Uint8Array {
  if (n < 0x80) return new Uint8Array([n]);
  const octets: number[] = [];
  let v = n;
  while (v > 0) {
    octets.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return new Uint8Array([0x80 | octets.length, ...octets]);
}

function tlv(tag: number, content: Uint8Array): Uint8Array {
  const len = derLength(content.length);
  const out = new Uint8Array(1 + len.length + content.length);
  out[0] = tag;
  out.set(len, 1);
  out.set(content, 1 + len.length);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const seq = (...parts: Uint8Array[]) => tlv(0x30, concat(...parts));
const set = (...parts: Uint8Array[]) => tlv(0x31, concat(...parts));
const utf8 = (s: string) => tlv(0x0c, new TextEncoder().encode(s));
const ia5Context6 = (s: string) => tlv(0x86, new TextEncoder().encode(s));
const octets = (b: Uint8Array) => tlv(0x04, b);
const boolTrue = () => tlv(0x01, new Uint8Array([0xff]));
const explicit = (n: number, b: Uint8Array) => tlv(0xa0 | n, b);

function integer(bytes: Uint8Array): Uint8Array {
  let v = bytes;
  while (v.length > 1 && v[0] === 0) v = v.subarray(1);
  // DER INTEGERs are signed: a leading high bit needs a zero byte in front.
  return tlv(0x02, v[0] & 0x80 ? concat(new Uint8Array([0]), v) : v);
}

function oid(dotted: string): Uint8Array {
  const arcs = dotted.split(".").map(Number);
  const body: number[] = [arcs[0] * 40 + arcs[1]];
  for (const arc of arcs.slice(2)) {
    const chunk: number[] = [arc & 0x7f];
    let v = Math.floor(arc / 128);
    while (v > 0) {
      chunk.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    body.push(...chunk);
  }
  return tlv(0x06, new Uint8Array(body));
}

function bitString(bytes: Uint8Array): Uint8Array {
  return tlv(0x03, concat(new Uint8Array([0]), bytes));
}

function utcTime(d: Date): Uint8Array {
  const p = (n: number) => String(n).padStart(2, "0");
  const text = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return tlv(0x17, new TextEncoder().encode(text));
}

function commonName(name: string): Uint8Array {
  return seq(set(seq(oid("2.5.4.3"), utf8(name))));
}

/** P1363 `r || s` back to the `SEQUENCE { INTEGER r, INTEGER s }` X.509 carries. */
function p1363ToDer(sig: Uint8Array): Uint8Array {
  const half = sig.length / 2;
  return seq(integer(sig.subarray(0, half)), integer(sig.subarray(half)));
}

// ------------------------------------------------------------------- minting

export type Curve = "P-256" | "P-384";

const SIG_ALG_OID: Record<Curve, string> = {
  "P-256": "1.2.840.10045.4.3.2", // ecdsa-with-SHA256
  "P-384": "1.2.840.10045.4.3.3", // ecdsa-with-SHA384
};
const HASH: Record<Curve, string> = { "P-256": "SHA-256", "P-384": "SHA-384" };

export type Authority = {
  readonly certDer: Uint8Array;
  readonly key: CryptoKeyPair;
  readonly curve: Curve;
};

async function keyPair(curve: Curve): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: curve },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
}

async function spkiOf(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey("spki", key));
}

async function signTbs(tbs: Uint8Array, signer: CryptoKey, curve: Curve): Promise<Uint8Array> {
  const raw = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: HASH[curve] }, signer, tbs as BufferSource),
  );
  return p1363ToDer(raw);
}

function buildCertificate(opts: {
  tbsInner: Uint8Array;
  signatureDer: Uint8Array;
  sigAlgOid: string;
}): Uint8Array {
  return seq(opts.tbsInner, seq(oid(opts.sigAlgOid)), bitString(opts.signatureDer));
}

function tbsFor(opts: {
  subject: string;
  issuer: string;
  spki: Uint8Array;
  notBefore: Date;
  notAfter: Date;
  sigAlgOid: string;
  extensions?: Uint8Array;
}): Uint8Array {
  return seq(
    explicit(0, integer(new Uint8Array([2]))), // version v3
    integer(new Uint8Array([0x01, 0x02, 0x03, 0x04])), // serialNumber
    seq(oid(opts.sigAlgOid)),
    commonName(opts.issuer),
    seq(utcTime(opts.notBefore), utcTime(opts.notAfter)),
    commonName(opts.subject),
    opts.spki,
    ...(opts.extensions ? [opts.extensions] : []),
  );
}

/** A self-signed authority that stands in for the pinned Fulcio intermediate. */
export async function makeAuthority(
  opts: { name?: string; curve?: Curve } = {},
): Promise<Authority> {
  const curve = opts.curve ?? "P-384";
  const name = opts.name ?? "acme test authority";
  const key = await keyPair(curve);
  const now = new Date("2020-01-01T00:00:00Z");
  const tbs = tbsFor({
    subject: name,
    issuer: name,
    spki: await spkiOf(key.publicKey),
    notBefore: now,
    notAfter: new Date("2040-01-01T00:00:00Z"),
    sigAlgOid: SIG_ALG_OID[curve],
  });
  return {
    certDer: buildCertificate({
      tbsInner: tbs,
      signatureDer: await signTbs(tbs, key.privateKey, curve),
      sigAlgOid: SIG_ALG_OID[curve],
    }),
    key,
    curve,
  };
}

export type SigningCert = { certDer: Uint8Array; key: CryptoKeyPair };

/** A short-lived signing certificate issued by `authority`, the way Fulcio issues one. */
export async function issueSigningCert(authority: Authority, opts: {
  sanUri: string;
  oidcIssuer: string;
  notBefore: Date;
  notAfter: Date;
}): Promise<SigningCert> {
  const key = await keyPair("P-256");
  const extensions = explicit(
    3,
    seq(
      // SAN is critical because the subject is empty, exactly as Fulcio emits it.
      seq(oid("2.5.29.17"), boolTrue(), octets(seq(ia5Context6(opts.sanUri)))),
      seq(oid("1.3.6.1.4.1.57264.1.8"), octets(utf8(opts.oidcIssuer))),
    ),
  );
  const tbs = tbsFor({
    subject: "",
    issuer: "acme test authority",
    spki: await spkiOf(key.publicKey),
    notBefore: opts.notBefore,
    notAfter: opts.notAfter,
    sigAlgOid: SIG_ALG_OID[authority.curve],
    extensions,
  });
  return {
    certDer: buildCertificate({
      tbsInner: tbs,
      signatureDer: await signTbs(tbs, authority.key.privateKey, authority.curve),
      sigAlgOid: SIG_ALG_OID[authority.curve],
    }),
    key,
  };
}

/** A DSSE-enveloped in-toto statement over `subjects`, signed by `cert`. */
export async function makeBundle(cert: SigningCert, opts: {
  subjects: { name: string; sha256: string }[];
  payloadType?: string;
  /** Corrupt the signature, to reach `signature-invalid` without touching anything else. */
  tamperSignature?: boolean;
}): Promise<string> {
  const payloadType = opts.payloadType ?? "application/vnd.in-toto+json";
  const payload = new TextEncoder().encode(JSON.stringify({
    _type: "https://in-toto.io/Statement/v1",
    subject: opts.subjects.map((s) => ({ name: s.name, digest: { sha256: s.sha256 } })),
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {},
  }));

  const encoder = new TextEncoder();
  const prefix = encoder.encode(
    `DSSEv1 ${payloadType.length} ${payloadType} ${payload.length} `,
  );
  const message = concat(prefix, payload);
  const raw = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      cert.key.privateKey,
      message as BufferSource,
    ),
  );
  if (opts.tamperSignature) raw[raw.length - 1] ^= 0xff;

  return JSON.stringify({
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    verificationMaterial: { certificate: { rawBytes: encodeBase64(cert.certDer) } },
    dsseEnvelope: {
      payloadType,
      payload: encodeBase64(payload),
      signatures: [{ sig: encodeBase64(p1363ToDer(raw)) }],
    },
  });
}
