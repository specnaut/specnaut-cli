/**
 * A path the filesystem adapters refused to act on because of where it leads:
 * out of the project, round a symlink cycle, through a directory that does not
 * exist, or onto the project directory itself. Part of the port contract, beside
 * `ReadFault`: the infrastructure's refusals extend it, so a use case can tell a
 * refusal — the path is not what it looks like — from a failure to act on a
 * path that is (cli#687), without importing an adapter.
 */
export class PathRefusal extends Error {
  override name = "PathRefusal";
}
