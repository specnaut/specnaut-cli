import { parse as parseJsonc } from "@std/jsonc";
import type { GitObjectReader } from "../application/script_trust_ports.ts";
import { imageFromDevcontainer, type ImageSource } from "../domain/sandbox_image.ts";
import { GitRefused } from "./untrusted_git.ts";

/**
 * The container image a sandboxed run uses, read from the base branch's tip, never from the work
 * tree: `.devcontainer/devcontainer.json`, else `.devcontainer.json`, as git objects. A branch
 * under review can edit the work tree's copy; the base's is the one a reviewer already accepted.
 * The file is JSON with comments; which of its fields count is `imageFromDevcontainer`'s decision
 * (only a digest-pinned `image:`). No image is ever built: a build needs the network, which a
 * sandboxed run never has.
 */

/** Paths in git's own spelling, `/` whatever the host. */
const CANDIDATES = [".devcontainer/devcontainer.json", ".devcontainer.json"];

/** The image the commit `base` pins (`null`: the base is unknown, so there is none). */
export async function readDevcontainerImage(
  git: Pick<GitObjectReader, "readFile">,
  base: string | null,
): Promise<ImageSource> {
  if (base === null) return none("the base branch's tip is unknown");
  for (const name of CANDIDATES) {
    const file = await git.readFile(base, name).catch(refusedAsWhy);
    if (typeof file === "string") return none(file);
    if (file.kind === "absent") continue;
    if (file.kind === "not_regular") return none(`${name} at the base is not a regular file`);
    try {
      return imageFromDevcontainer(parseJsonc(new TextDecoder().decode(file.bytes)));
    } catch (err) {
      // The reason is the probe's answer: it is printed, never swallowed.
      return none(`${name} is not JSON with comments: ${(err as Error).message}`);
    }
  }
  return imageFromDevcontainer(null);
}

function none(why: string): ImageSource {
  return { kind: "none", why };
}

/** git's refusal (a blob over the cap, a commit it cannot read) as the probe's reason. */
function refusedAsWhy(err: unknown): string {
  if (err instanceof GitRefused) return `the devcontainer cannot be read: ${err.message}`;
  throw err;
}
