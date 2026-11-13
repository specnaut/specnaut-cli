import { MAX_SCRIPT_BYTES } from "../application/script_trust_ports.ts";
import type { BaseEntry } from "../domain/script_trust.ts";
import { decode } from "./git_text.ts";
import { GitRefused, type UntrustedGit } from "./untrusted_git.ts";

/**
 * A commit's tree as `GitObjects` (`git_object_reader.ts`) reads it: `ls-tree` records, then each
 * blob's raw bytes through one `cat-file --batch`. Objects only: nothing here reads the work tree.
 */

/** A blob `ls-tree -l` listed: a file's, or a link's, whose bytes are its target. */
type BlobRecord = { kind: "blob" | "link"; path: string; sha: string; size: number };
type FileRecord = BlobRecord | { kind: "submodule"; path: string; commit: string };
type TreeRecord = FileRecord | { kind: "tree"; path: string };

/** `ls-tree -z -l --full-tree`, paths made relative to `prefix`; a tree entry only on `trees`. */
export async function lsTree(
  git: UntrustedGit,
  prefix: string,
  commit: string,
  args: string[],
  trees = false,
): Promise<TreeRecord[]> {
  const argv = ["-z", "-l", "--full-tree", commit, ...args];
  const records: TreeRecord[] = [];
  for (const line of decode(await git.run("ls-tree", argv)).split("\0")) {
    const m = /^(\d+) (\w+) ([0-9a-f]+) +(-|\d+)\t(.*)$/s.exec(line);
    if (m === null || !m[5].startsWith(prefix)) continue;
    const path = m[5].slice(prefix.length);
    const blob = { path, sha: m[3], size: Number(m[4]) };
    if (m[1] === "160000") records.push({ kind: "submodule", path, commit: m[3] });
    else if (m[1] === "120000") records.push({ kind: "link", ...blob });
    else if (m[2] === "blob") records.push({ kind: "blob", ...blob });
    else if (trees && m[2] === "tree") records.push({ kind: "tree", path });
  }
  return records;
}

/** Each record with its blob's bytes, a link with its target. */
export async function withBytes(
  git: UntrustedGit,
  commit: string,
  records: TreeRecord[],
): Promise<BaseEntry[]> {
  const files = records.filter((r): r is FileRecord => r.kind !== "tree");
  const blobs = files.filter((r): r is BlobRecord => r.kind !== "submodule");
  const bytes = await catFiles(git, commit, blobs);
  return files.map((r): BaseEntry => {
    if (r.kind === "submodule") return r;
    if (r.kind === "link") return { kind: "link", path: r.path, target: decode(bytes.get(r.sha)!) };
    return { kind: "blob", path: r.path, bytes: bytes.get(r.sha)! };
  });
}

/**
 * Each blob's raw bytes, a link's included, through one `cat-file --batch`. The sizes `ls-tree`
 * listed are checked first: a blob over the cap is refused by its path, before any of it is read.
 */
export async function catFiles(
  git: UntrustedGit,
  commit: string,
  blobs: BlobRecord[],
): Promise<Map<string, Uint8Array>> {
  const found = new Map<string, Uint8Array>();
  const over = blobs.find((b) => b.size > MAX_SCRIPT_BYTES);
  if (over) throw new GitRefused(`${over.path} at ${commit} is over ${MAX_SCRIPT_BYTES} bytes`);
  if (blobs.length === 0) return found;
  const input = new TextEncoder().encode(blobs.map((b) => `${b.sha}\n`).join(""));
  const out = await git.run("cat-file", ["--batch"], input);
  let at = 0;
  while (at < out.length) {
    const eol = out.indexOf(0x0a, at);
    const [sha, type, size] = decode(out.subarray(at, eol)).split(" ");
    if (type !== "blob") throw new Error(`git cat-file: ${sha} is ${type ?? "missing"}`);
    const start = eol + 1;
    found.set(sha, out.slice(start, start + Number(size)));
    at = start + Number(size) + 1;
  }
  return found;
}
