/** `raw` if it is one of `known`, `null` if absent; `{ ok: false }` names an unknown value. */
export function validateKnownArg<T extends string>(
  raw: string | null,
  known: ReadonlyArray<T>,
): { ok: true; value: T | null } | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  return (known as ReadonlyArray<string>).includes(raw)
    ? { ok: true, value: raw as T }
    : { ok: false };
}
