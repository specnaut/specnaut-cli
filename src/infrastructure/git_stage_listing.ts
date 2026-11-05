import type { TrackedEntry, TrackedListing } from "../application/structural_scan_ports.ts";

/** Names decoded fatally: a name that is not UTF-8 is skipped, never read under a guessed name. */
export const NAME = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** The index modes that are not a file: a link, and a submodule's commit. */
const MODES: ReadonlyMap<string, TrackedEntry["mode"]> = new Map([
  ["120000", "symlink"],
  ["160000", "submodule"],
]);

/**
 * `ls-files -z --stage`: `<mode> <object> <stage>\t<name>\0`, a conflicted name once per stage,
 * consecutively. Each name is kept once, compared as bytes, and decoded fatally.
 */
export function parseStage(out: Uint8Array): TrackedListing {
  const listing = { entries: [] as TrackedEntry[], undecodable: 0 };
  let previous: Uint8Array | null = null;
  for (let start = 0; start < out.length;) {
    const end = out.indexOf(0, start);
    const record = out.subarray(start, end < 0 ? out.length : end);
    start = end < 0 ? out.length : end + 1;
    const tab = record.indexOf(0x09);
    const name = record.subarray(tab + 1);
    if (tab < 0 || (previous !== null && sameBytes(previous, name))) continue;
    previous = name;
    const mode = new TextDecoder().decode(record.subarray(0, record.indexOf(0x20)));
    addEntry(listing, name, MODES.get(mode) ?? "file");
  }
  return listing;
}

function addEntry(
  listing: { entries: TrackedEntry[]; undecodable: number },
  name: Uint8Array,
  mode: TrackedEntry["mode"],
) {
  try {
    listing.entries.push({ path: NAME.decode(name), mode });
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    listing.undecodable++; // not UTF-8: counted, and reported as skipped
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
