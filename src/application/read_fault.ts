/**
 * The filesystem itself refused a read — a permission, an I/O error — at a
 * path that passed every containment check. Part of the `FsReader` contract
 * (cli#704): it is the one throw a caller may report as "cannot be read".
 * Anything else a reader throws — a link that leaves the project, a cycle — is
 * a refusal with its own words, and relabelling it "cannot be read" told the
 * user to fix permissions on a file that was fine. The message is the
 * filesystem's own; the original error is the `cause`.
 */
export class ReadFault extends Error {
  override name = "ReadFault";
}
