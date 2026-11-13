import { sha256HexBytes } from "./sha256.ts";
import type { BaseEntry, TreeEntry, TreeWalk } from "./script_trust.ts";

/**
 * One digest of the scripts folder as the walk found it: what a user's approval of an untrusted
 * verdict covers, so a later check over other bytes is a new question, never the same yes. Each
 * entry is framed by its kind, its path and its length, in path order, so no two walks share a
 * digest by moving bytes between files.
 */
export async function scriptsDigest(walk: TreeWalk): Promise<string> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  if (walk.kind === "blocked") {
    parts.push(enc.encode(`blocked\0${walk.path}\0${walk.why}\0`));
  } else {
    const sorted = [...walk.entries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    for (const entry of sorted) parts.push(...frame(entry, enc));
  }
  return await sha256HexBytes(concat(parts));
}

/** One path as HEAD commits it: an entry of its tree, or one that is not a file git reads. */
export type HeadEntry = BaseEntry | { readonly kind: "not_regular"; readonly path: string };

/**
 * One digest of the instruction files as HEAD commits them: what a yes to their untrusted verdict
 * covers. The yes is given to the bytes that land, never to the paths named, so a later commit to
 * a path already approved digests otherwise and asks again. Framed as {@link scriptsDigest} frames
 * a walk, a link by its target, so a link and a file of its target text differ.
 */
export async function headDigest(entries: readonly HeadEntry[]): Promise<string> {
  const enc = new TextEncoder();
  const sorted = [...entries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const parts = sorted.flatMap((e) => {
    const bytes = e.kind === "blob" ? e.bytes : enc.encode(e.kind === "link" ? e.target ?? "" : "");
    return [enc.encode(`${e.kind}\0${e.path}\0${bytes.length}\0`), bytes];
  });
  return await sha256HexBytes(concat(parts));
}

function frame(entry: TreeEntry, enc: TextEncoder): Uint8Array[] {
  const bytes = entry.kind === "file" ? entry.bytes : new Uint8Array();
  const links = entry.kind === "file" ? entry.links : 0;
  return [enc.encode(`${entry.kind}\0${entry.path}\0${links}\0${bytes.length}\0`), bytes];
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
