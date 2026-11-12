/**
 * What a git object id is beyond its shape (`isFullSha` in `commit_sha.ts`, the one home of that
 * rule): its width in bytes, its hex spelling, and the id git gives a blob's bytes.
 */

/** How many raw bytes an id of this format takes in a tree object. */
export const idBytes = (id: string): number => id.length / 2;

/** Raw bytes as the lowercase hex git prints. */
export const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** The object format a full id belongs to, by its length. */
export const formatOf = (id: string): "sha1" | "sha256" => id.length === 64 ? "sha256" : "sha1";

/**
 * The id git gives a blob's bytes: the hash of `blob <size>\0` and the bytes. It lets a file on disk
 * be checked against the commit it was written from without asking git, whose view of a folder its
 * configuration could steer.
 */
export async function gitBlobId(bytes: Uint8Array, format: "sha1" | "sha256"): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const framed = new Uint8Array(header.length + bytes.length);
  framed.set(header);
  framed.set(bytes, header.length);
  const digest = await crypto.subtle.digest(format === "sha1" ? "SHA-1" : "SHA-256", framed);
  return hex(new Uint8Array(digest));
}
