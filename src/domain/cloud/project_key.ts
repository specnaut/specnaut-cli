// Derive a Cloud project **key** from a human project **name** (#417 UX).
//
// The key is the task-number prefix (e.g. `CLOUD` → CLOUD-12), so the server
// constrains it to `/^[A-Z][A-Z0-9]{1,9}$/` — 2–10 chars, uppercase
// letters/digits, first char a letter, unique per org. Rather than make the
// user hand-craft that (the old "New project key (2–10 uppercase)" prompt that
// tripped everyone up), we slugify the name they already typed and append a
// numeric suffix when the slug is taken.

export const MAX_KEY_LEN = 10;
const MIN_KEY_LEN = 2;
/** Used when the name has no usable letters/digits at all (e.g. "!!!"). */
const FALLBACK_BASE = "PROJECT";

/**
 * Slugify a name into a *candidate* key base — uppercase, `[A-Z0-9]` only,
 * first char forced to a letter (leading digits dropped, since the key must
 * start `[A-Z]`), padded to the 2-char minimum and clamped to `MAX_KEY_LEN`.
 * Does NOT dedupe — that's `generateProjectKey`'s job.
 */
export function slugifyKeyBase(name: string): string {
  let base = name.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^[0-9]+/, "");
  if (base.length < MIN_KEY_LEN) base = (base + FALLBACK_BASE);
  return base.slice(0, MAX_KEY_LEN);
}

/**
 * Turn a project name into a valid, currently-free key. Slugifies the name,
 * then — if that base collides with an existing key (case-insensitive) —
 * appends the smallest integer suffix ≥ 2 that fits inside `MAX_KEY_LEN`
 * (truncating the base as needed so `base+suffix` never exceeds the cap):
 * `PHOTOSHOP` → `PHOTOSHOP2` → `PHOTOSHOP3` … The result always satisfies the
 * server regex.
 */
export function generateProjectKey(name: string, existing: Iterable<string>): string {
  const taken = new Set<string>();
  for (const k of existing) taken.add(k.toUpperCase());

  const base = slugifyKeyBase(name);
  if (!taken.has(base)) return base;

  for (let i = 2; i < 100000; i++) {
    const suffix = String(i);
    const candidate = base.slice(0, MAX_KEY_LEN - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
  // Unreachable in practice (99998 collisions on one slug); keep the type total.
  return base;
}
