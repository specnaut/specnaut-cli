import { dim } from "@std/fmt/colors";

/**
 * The lines `init` and `upgrade` print about what a write moved aside. One
 * home for both, because the two handlers used to carry the same sentences
 * twice — and a sentence about the user's data that exists in two copies is
 * one edit away from saying two different things.
 */

/** A backup of file content. */
export const backupLine = (dest: string): string =>
  dim(`↳ backed up ${dest} → ${dest}.specnaut.bak`);

/**
 * A backup that moved a SYMLINK, not content (cli#574): the user's bytes are
 * still where the link pointed, and restoring the backup restores a pointer.
 */
export const linkMovedLine = (dest: string): string =>
  dim(
    `↳ ${dest} was a SYMLINK — the link was moved to ${dest}.specnaut.bak, not its content.\n` +
      `  Your file is still where the link pointed. Restoring the backup restores a pointer.`,
  );
