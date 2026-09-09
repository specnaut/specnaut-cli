/**
 * The one field of an in-toto statement this verifier acts on: which artefact
 * digests the signature covers.
 *
 * Everything else in a SLSA provenance predicate — the builder, the invocation,
 * the materials — is evidence a human might read. None of it is checked here,
 * and pretending otherwise would be the more dangerous shape: a verifier that
 * parses a field it does not enforce reads as though it did.
 */

export type Subject = {
  readonly name: string;
  /** Lowercase hex, as in-toto encodes it. */
  readonly sha256: string;
};

export class StatementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementError";
  }
}

export function parseSubjects(payload: Uint8Array): Subject[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payload));
  } catch (e) {
    throw new StatementError(`statement is not JSON: ${(e as Error).message}`);
  }
  const subject = (parsed as { subject?: unknown })?.subject;
  if (!Array.isArray(subject) || subject.length === 0) {
    throw new StatementError("statement carries no subject");
  }
  return subject.map((raw, i) => {
    const name = (raw as { name?: unknown })?.name;
    const sha256 = (raw as { digest?: { sha256?: unknown } })?.digest?.sha256;
    if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
      throw new StatementError(`subject ${i} has no usable sha256 digest`);
    }
    return { name: typeof name === "string" ? name : `<subject ${i}>`, sha256 };
  });
}
