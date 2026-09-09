/**
 * The smallest DER reader that can walk a Fulcio certificate and a DSSE
 * signature. Deliberately not a general ASN.1 library.
 *
 * Everything here is pure and synchronous, which is the point: the whole
 * negative matrix in `verify.ts` — a truncated buffer, a foreign identity, a
 * flipped signature byte — is a unit test with no I/O. `src/domain/sha256.ts`
 * is the precedent for reaching for WebCrypto from `domain/`: the layer's rule
 * is no `Deno.*`, no filesystem, no network, not "no Web standards".
 *
 * **This parser is deliberately strict and never repairs.** Every malformed
 * shape throws {@link DerError}, and `verify.ts` turns that into one named
 * failure reason. A parser that guesses is how a verifier ends up reporting
 * success on input it did not understand.
 */

/** A parsed tag-length-value, described by offsets into the buffer it came from. */
export type Tlv = {
  /** The identifier octet, including class and constructed bits. */
  readonly tag: number;
  /** Offset of the identifier octet — where the TLV's own bytes begin. */
  readonly header: number;
  /** Offset of the first content byte. */
  readonly start: number;
  /** Offset one past the last content byte. */
  readonly end: number;
  /** Offset one past the whole TLV — where a sibling begins. */
  readonly next: number;
};

export class DerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DerError";
  }
}

/** Universal tags this reader knows by name. */
export const TAG = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  SEQUENCE: 0x30,
  SET: 0x31,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
} as const;

/** `[n]` in a context-specific, constructed position — e.g. `[3] EXPLICIT` extensions. */
export function contextConstructed(n: number): number {
  return 0xa0 | n;
}

/** `[n]` in a context-specific, primitive position — e.g. SAN's `uniformResourceIdentifier [6]`. */
export function contextPrimitive(n: number): number {
  return 0x80 | n;
}

export function readTlv(buf: Uint8Array, offset: number): Tlv {
  if (offset < 0 || offset >= buf.length) {
    throw new DerError(`read past end of buffer at ${offset}`);
  }
  const tag = buf[offset];
  // High-tag-number form (tag bits all set) never appears in X.509 or in a
  // Sigstore bundle. Refusing it is one less parser state to get wrong.
  if ((tag & 0x1f) === 0x1f) throw new DerError("high-tag-number form is not supported");

  let cursor = offset + 1;
  if (cursor >= buf.length) throw new DerError("truncated: no length octet");
  const first = buf[cursor++];

  let len: number;
  if (first < 0x80) {
    len = first;
  } else if (first === 0x80) {
    // Legal in BER, forbidden in DER. Accepting it would let a re-encoded
    // certificate carry content this reader measures differently from
    // whatever produced the signature.
    throw new DerError("indefinite length is not valid DER");
  } else if (first === 0xff) {
    throw new DerError("reserved length octet 0xff");
  } else {
    const n = first & 0x7f;
    if (n > 4) throw new DerError(`length of ${n} octets is beyond anything expected here`);
    if (cursor + n > buf.length) throw new DerError("truncated: length octets run past end");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[cursor++];
    // DER requires the shortest possible length encoding.
    if (len < 0x80) throw new DerError("non-minimal long-form length");
  }

  const start = cursor;
  const end = start + len;
  if (end > buf.length) throw new DerError(`truncated: content runs ${end - buf.length} past end`);
  return { tag, header: offset, start, end, next: end };
}

/** Every direct child of a constructed TLV, in order. */
export function children(buf: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let cursor = parent.start;
  while (cursor < parent.end) {
    const tlv = readTlv(buf, cursor);
    if (tlv.next > parent.end) throw new DerError("child TLV overruns its parent");
    out.push(tlv);
    cursor = tlv.next;
  }
  return out;
}

/** Assert a TLV's tag, and say which one was found when it is wrong. */
export function expectTag(tlv: Tlv, tag: number, what: string): Tlv {
  if (tlv.tag !== tag) {
    throw new DerError(
      `${what}: expected tag 0x${tag.toString(16)}, found 0x${tlv.tag.toString(16)}`,
    );
  }
  return tlv;
}

export function contentOf(buf: Uint8Array, tlv: Tlv): Uint8Array {
  return buf.subarray(tlv.start, tlv.end);
}

/**
 * The whole TLV including its header — what a signature is computed over.
 *
 * An X.509 signature covers the DER encoding of `tbsCertificate`, header
 * included. Recording the header offset when the TLV is read is the only
 * reliable way to recover it: searching backwards for a header that re-parses
 * to the same content offset finds a plausible answer on some inputs and the
 * wrong one on others.
 */
export function tlvBytes(buf: Uint8Array, tlv: Tlv): Uint8Array {
  return buf.subarray(tlv.header, tlv.end);
}

/** Dotted-decimal form of an OBJECT IDENTIFIER's content octets. */
export function oidToString(buf: Uint8Array, tlv: Tlv): string {
  expectTag(tlv, TAG.OID, "object identifier");
  const bytes = contentOf(buf, tlv);
  if (bytes.length === 0) throw new DerError("empty object identifier");
  const parts: number[] = [];
  const first = bytes[0];
  parts.push(Math.floor(first / 40), first % 40);
  let value = 0;
  let started = false;
  for (let i = 1; i < bytes.length; i++) {
    const b = bytes[i];
    if (!started && b === 0x80) throw new DerError("non-minimal OID arc");
    started = true;
    value = value * 128 + (b & 0x7f);
    if ((b & 0x80) === 0) {
      parts.push(value);
      value = 0;
      started = false;
    }
  }
  if (started) throw new DerError("object identifier ends mid-arc");
  return parts.join(".");
}

/**
 * UTCTime / GeneralizedTime as a `Date`.
 *
 * X.509 UTCTime carries a two-digit year, and RFC 5280 pins the window: 00-49
 * is 2000-2049, 50-99 is 1950-1999. Getting that backwards would put a valid
 * certificate a century out and read as expired.
 */
export function derTimeToDate(buf: Uint8Array, tlv: Tlv): Date {
  const text = new TextDecoder().decode(contentOf(buf, tlv));
  let iso: string;
  if (tlv.tag === TAG.UTC_TIME) {
    const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text);
    if (!m) throw new DerError(`unsupported UTCTime: ${text}`);
    const yy = Number(m[1]);
    const year = yy < 50 ? 2000 + yy : 1900 + yy;
    iso = `${year}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  } else if (tlv.tag === TAG.GENERALIZED_TIME) {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text);
    if (!m) throw new DerError(`unsupported GeneralizedTime: ${text}`);
    iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  } else {
    throw new DerError(`not a time tag: 0x${tlv.tag.toString(16)}`);
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new DerError(`unparseable time: ${text}`);
  return date;
}

/**
 * ECDSA `SEQUENCE { INTEGER r, INTEGER s }` to the fixed-width `r || s` pair
 * WebCrypto expects.
 *
 * `crypto.subtle.verify` takes P1363, X.509 and DSSE both carry DER. Without
 * this conversion every signature check fails — which is the failure mode that
 * looks like a security finding and is a format bug.
 */
export function derEcdsaToP1363(sig: Uint8Array, coordBytes: number): Uint8Array {
  const seq = expectTag(readTlv(sig, 0), TAG.SEQUENCE, "ECDSA signature");
  if (seq.next !== sig.length) throw new DerError("trailing bytes after ECDSA signature");
  const parts = children(sig, seq);
  if (parts.length !== 2) throw new DerError(`ECDSA signature has ${parts.length} parts, not 2`);

  const out = new Uint8Array(coordBytes * 2);
  parts.forEach((part, i) => {
    expectTag(part, TAG.INTEGER, "ECDSA signature component");
    let bytes = contentOf(sig, part);
    // DER INTEGERs are signed, so a coordinate with the high bit set carries a
    // leading zero. Strip it; anything longer than the curve is malformed.
    while (bytes.length > 1 && bytes[0] === 0x00) bytes = bytes.subarray(1);
    if (bytes.length > coordBytes) {
      throw new DerError(`ECDSA component is ${bytes.length} bytes, curve holds ${coordBytes}`);
    }
    out.set(bytes, coordBytes * (i + 1) - bytes.length);
  });
  return out;
}
