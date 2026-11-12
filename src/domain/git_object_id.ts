/**
 * The id git gives a blob's bytes: the hash of `blob <size>\0` and the bytes, SHA-1 or SHA-256 by
 * the repository's object format. It lets a file on disk be checked against the commit it was
 * written from without asking git, whose view of a folder its configuration could steer.
 */
export async function gitBlobId(bytes: Uint8Array, format: "sha1" | "sha256"): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const framed = new Uint8Array(header.length + bytes.length);
  framed.set(header);
  framed.set(bytes, header.length);
  const digest = await crypto.subtle.digest(format === "sha1" ? "SHA-1" : "SHA-256", framed);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The object format a full id belongs to, by its length. */
export const formatOf = (id: string): "sha1" | "sha256" => id.length === 64 ? "sha256" : "sha1";
