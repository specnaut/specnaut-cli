/**
 * Whether git holds a blob binary, which `git diff` then counts as `-` lines: the attribute first,
 * then the size, then a NUL in the sniff window. Kept apart from `size_exempt.ts` because the
 * attribute comes from git and the sniff from the bytes, which only the adapter reads.
 */

/** git's own sniff window: a NUL in the first 8000 bytes makes a blob binary. */
export const BINARY_SNIFF_BYTES = 8000;

/** git's default `core.bigFileThreshold`: a larger file is binary to `git diff` whatever it holds. */
const BIG_FILE_BYTES = 512 * 1024 * 1024;

/** Whether a file of `size` bytes is binary by its size alone, before a byte of it is read. */
export const binaryBySize = (size: number): boolean => size > BIG_FILE_BYTES;

/** Whether the first bytes of a file hold a NUL, as git judges a blob binary. */
export function hasNulPrefix(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true;
  return false;
}

/**
 * What `git check-attr diff` says about binariness: `unset` (`-diff`, or the `binary` macro) is
 * binary, `set` is text whatever the bytes, anything else leaves it to the size and the sniff.
 */
export function binaryByAttribute(value: string): boolean | null {
  if (value === "unset") return true;
  return value === "set" ? false : null;
}
