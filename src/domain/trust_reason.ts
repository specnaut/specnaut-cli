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
  lineEndings: "line endings differ",
  behind: "behind base: rebase",
  differs: "differs from base",
  baseNotRegular: "not a regular file on base",
} as const;

/** The bytes with every CR before an LF dropped: only ever used to name a reason. */
export function withoutCr(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    if (!(bytes[i] === 0x0d && bytes[i + 1] === 0x0a)) out.push(bytes[i]);
  }
  return Uint8Array.from(out);
}
