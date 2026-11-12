/**
 * Whether `s` is a full commit sha as git prints one: 40 hex digits (SHA-1) or 64 (SHA-256), lower
 * case. Checked before a sha reaches git, so nothing a caller passes can read as an option, a range
 * or an abbreviation that resolves to another object.
 */
export function isFullSha(s: string): boolean {
  return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(s);
}
