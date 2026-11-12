/** Whether `a` and `b` hold the same bytes; `b` absent is never a match. */
export function sameBytes(a: Uint8Array, b: Uint8Array | undefined): boolean {
  if (b === undefined || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
