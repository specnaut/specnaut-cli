/**
 * A path holding a code point outside ASCII, as the instruction class reads it. A case-blind disk
 * folds more than ASCII letters, and each disk folds its own way: one opens a name spelled with
 * U+017F (long s) or U+0131 (dotless i) as the ASCII name, another ignores a code point outright.
 * No fold written here would agree with every disk, so such a name is never matched to another
 * one: it is named and asked about (`NON_ASCII_REASON`), as the gate's impact graph refuses one.
 * Its {@link asciiSkeleton} says only which surface it might stand for.
 */

/** The reason a path holding a code point outside ASCII gets. */
export const NON_ASCII_REASON = "name holds a non-ASCII character";

/** Whether `path` holds a code point outside ASCII. */
export const holdsNonAscii = (path: string): boolean => /\P{ASCII}/u.test(path);

/**
 * The ASCII names a disk might open for `path`, as one string, folded to lower case: each code
 * point read through its compatibility decomposition and its upper case (U+017F is an s, U+0131
 * an i once upper-cased, U+212A a k), lower-cased first so that U+1E9E reaches the ss its small
 * letter upper-cases to, and each one still outside ASCII dropped, as a disk drops a code point
 * it ignores. It errs towards a match: a name it brings into scope is asked about, and
 * never taken for the name it reads as.
 */
export function asciiSkeleton(path: string): string {
  const read = path.normalize("NFKD").toLowerCase().toUpperCase().toLowerCase().normalize("NFKD");
  return read.replace(/\P{ASCII}/gu, "");
}
