/**
 * The container image a branch's gates run in, read from the base branch's devcontainer.
 *
 * Only `image:` is read, and only when it is pinned by a sha256 digest: a tag can be moved to
 * other bytes after the base was reviewed. Every other devcontainer field — mounts, run
 * arguments, lifecycle commands, environment, features, the remote user — would hand the sandbox
 * a host folder, a privilege or a host command, so none is read. Nor is the image's own entrypoint
 * run: `containerArgs` empties it. Pure: the caller parses the file (it is JSON with comments)
 * and passes the value.
 */

/** Where the image comes from: a pinned reference, or why there is none. */
export type ImageSource =
  | { readonly kind: "pinned"; readonly ref: string }
  | { readonly kind: "none"; readonly why: string };

/**
 * A reference ending in a sha256 digest. It starts with a letter or digit, so it can never be
 * read as a flag where it is passed as an argument.
 */
const PINNED = /^[a-z0-9][a-z0-9._/:-]{0,254}@sha256:[0-9a-f]{64}$/;

/** Whether `ref` names an image by its digest. */
export function isPinned(ref: string): boolean {
  return PINNED.test(ref);
}

/** The image `config` (a parsed `devcontainer.json`, or `null` when there is none) pins. */
export function imageFromDevcontainer(config: unknown): ImageSource {
  if (config === null || config === undefined) return none("no devcontainer");
  if (typeof config !== "object" || Array.isArray(config)) {
    return none("the devcontainer is not an object");
  }
  const image = (config as Record<string, unknown>).image;
  if (typeof image !== "string") return none("the devcontainer names no image");
  if (!isPinned(image)) return none("the devcontainer image is not pinned by digest");
  return { kind: "pinned", ref: image };
}

function none(why: string): ImageSource {
  return { kind: "none", why };
}
