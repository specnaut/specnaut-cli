/**
 * DSSE — the envelope Sigstore signs an in-toto statement inside.
 *
 * The signature is not over the payload. It is over the Pre-Authentication
 * Encoding: a length-prefixed framing of the payload type and the payload
 * together. Signing the payload alone would let the same bytes be replayed
 * under a different type, which is the whole reason PAE exists.
 *
 * https://github.com/secure-systems-lab/dsse/blob/master/protocol.md
 */

/**
 * `DSSEv1 <len(type)> <type> <len(payload)> <payload>`, with single spaces and
 * ASCII decimal lengths. The lengths count BYTES, not characters — encoding the
 * payload's length from a decoded string would be wrong for any non-ASCII
 * content and right for the fixture that never has any.
 */
export function preAuthEncoding(payloadType: string, payload: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const typeBytes = encoder.encode(payloadType);
  const prefix = encoder.encode(
    `DSSEv1 ${typeBytes.length} ${payloadType} ${payload.length} `,
  );
  const out = new Uint8Array(prefix.length + payload.length);
  out.set(prefix, 0);
  out.set(payload, prefix.length);
  return out;
}
