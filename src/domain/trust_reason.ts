import { sameBytes } from "./bytes.ts";

/**
 * The reasons the script, config and instruction checks give, in one place, so that each check
 * names the same mismatch the same way.
 */

/** The reasons, worded once: the phases quote them in a `NOT RUN` line. */
export const REASON = {
  link: "a link",
  notRegular: "not a regular file",
  hardLinked: "hard-linked",
  notOnBase: "not on base",
  firstInstall: "first install: no base copy",
  missing: "on base, missing from the tree",
  submodule: "a submodule on base",
  caseDiffers: "name differs in case from base",
  // The text is the same, so a diff of it can be empty: the reason itself says what differs.
  lineEndings: "line endings differ: the same text but for a CR before LF; a diff can be empty",
  behind: "behind base: rebase",
  differs: "differs from base",
  baseNotRegular: "not a regular file on base",
} as const;

/** What a mismatch is measured against: each trusted copy, and the merge base's bytes. */
export type Copies = {
  readonly copies: readonly (Uint8Array | undefined)[];
  readonly mergeBase?: Uint8Array;
};

/**
 * The reason bytes that match no trusted copy get, said as precisely as the bytes allow: `line
 * endings differ` when they equal a copy but for a CR before an LF, `behind base: rebase` when
 * they are the merge base's own (only the base moved), else `otherwise`. The CR is dropped on both
 * sides: a base committed with CRLF and a tree checked out with LF differ only in line endings,
 * exactly as the reverse does. Behind compares raw bytes, as trust does. Only ever names a reason;
 * nothing is trusted here.
 */
export function refinedReason(mine: Uint8Array, against: Copies, otherwise: string): string {
  const lf = withoutCr(mine);
  const copies = against.copies.flatMap((c) => c === undefined ? [] : [withoutCr(c)]);
  if (copies.some((c) => sameBytes(lf, c))) return REASON.lineEndings;
  return sameBytes(mine, against.mergeBase) ? REASON.behind : otherwise;
}

/** The bytes with every CR before an LF dropped: only ever used to name a reason. */
function withoutCr(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    if (!(bytes[i] === 0x0d && bytes[i + 1] === 0x0a)) out.push(bytes[i]);
  }
  return Uint8Array.from(out);
}
