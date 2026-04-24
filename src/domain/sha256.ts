/**
 * Lowercase hex SHA-256 of the UTF-8 encoding of `input`.
 * Shared helper — used by self-update (binary checksum) and upgrade (file
 * integrity tracking in .specflow/installed.lock).
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Same as `sha256Hex` but for already-encoded bytes (e.g. downloaded binary).
 */
export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
