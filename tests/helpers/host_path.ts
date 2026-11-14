import { SEPARATOR } from "@std/path";

/**
 * `posix` spelt as the host spells a real path: its `/` turned into the host's separator. A
 * resolved path (`Deno.realPath`, the review lock's recorded folders) carries `\` on Windows, and
 * the lock's containment check splits on the host's separator alone, so a fixture standing for a
 * resolved path must be spelt the same way to mean the same folder there.
 */
export const hostPath = (posix: string): string => posix.replaceAll("/", SEPARATOR);
