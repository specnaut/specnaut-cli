import type { FileRead, ReadRequest } from "../application/structural_scan_ports.ts";
import { MAX_TEXT_BYTES } from "../domain/code_units/estimate_units.ts";
import { BINARY_SNIFF_BYTES, binaryBySize, hasNulPrefix } from "../domain/size_exempt.ts";
import { countNewlines } from "../domain/size_limits.ts";

/**
 * How the bytes of a file `git_tracked_files.ts` has already admitted are counted (plan § 5, "How a
 * file is read"): up to the estimator's cap in one `readFile`, above it streamed through one fixed
 * buffer and counted on bytes, never decoded. Whether a path may be opened, and what counts as
 * binary (`size_exempt.ts`), are not decided here: it only asks.
 */

/** The streaming buffer: larger than git's sniff window, so the first chunk holds all of it. */
const CHUNK_BYTES = 64 * 1024;

const BINARY: FileRead = { kind: "binary" };

/** A regular file of `size` bytes (its `lstat`), read as `request` asks. */
export async function readAdmitted(abs: string, size: number, request: ReadRequest) {
  if (request.sniff && binaryBySize(size)) return BINARY;
  if (size > MAX_TEXT_BYTES) return await streamed(abs, request.sniff);
  const bytes = await Deno.readFile(abs);
  if (request.sniff && hasNulPrefix(bytes)) return BINARY;
  // A file that grew since its `lstat` is still counted, but not handed to the estimator.
  const text = request.decode && bytes.length <= MAX_TEXT_BYTES ? decode(bytes) : null;
  return { kind: "text", lines: countNewlines(bytes), text } satisfies FileRead;
}

/** As `Deno.readTextFile` decodes: an invalid sequence replaced, which changes no line count. */
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** A file over the cap: the sniff window filled first, then every chunk counted and dropped. */
async function streamed(abs: string, sniff: boolean): Promise<FileRead> {
  const file = await Deno.open(abs, { read: true });
  try {
    const buf = new Uint8Array(CHUNK_BYTES);
    const filled = await fillSniffWindow(file, buf);
    // A NUL in the first chunk stops the read: the rest of a binary file is never touched.
    if (sniff && hasNulPrefix(buf.subarray(0, filled))) return BINARY;
    let lines = countNewlines(buf.subarray(0, filled));
    for (let n = await file.read(buf); n !== null; n = await file.read(buf)) {
      lines += countNewlines(buf.subarray(0, n));
    }
    return { kind: "text", lines, text: null };
  } finally {
    file.close();
  }
}

/** Reads until git's sniff window is full or the file ends: a short read must not hide a NUL. */
async function fillSniffWindow(file: Deno.FsFile, buf: Uint8Array): Promise<number> {
  let filled = 0;
  while (filled < BINARY_SNIFF_BYTES) {
    const n = await file.read(buf.subarray(filled));
    if (n === null) break;
    filled += n;
  }
  return filled;
}
