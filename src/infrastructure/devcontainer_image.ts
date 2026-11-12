import { parse as parseJsonc } from "@std/jsonc";
import { join } from "@std/path";
import { imageFromDevcontainer, type ImageSource } from "../domain/sandbox_image.ts";

/**
 * The container image a sandboxed run uses, read from the checkout's own devcontainer:
 * `.devcontainer/devcontainer.json`, else `.devcontainer.json`. The file is JSON with comments;
 * which of its fields count is `imageFromDevcontainer`'s decision (only a digest-pinned `image:`).
 * No image is ever built: a build needs the network, which a sandboxed run never has.
 */

const CANDIDATES = [join(".devcontainer", "devcontainer.json"), ".devcontainer.json"];
const MAX_BYTES = 1024 * 1024;

export async function readDevcontainerImage(checkout: string): Promise<ImageSource> {
  for (const name of CANDIDATES) {
    const info = await Deno.lstat(join(checkout, name)).catch(notFoundAsNull);
    if (info === null) continue;
    if (!info.isFile) return none(`${name} is not a regular file`);
    if (info.size > MAX_BYTES) return none(`${name} is larger than ${MAX_BYTES} bytes`);
    const text = await Deno.readTextFile(join(checkout, name));
    try {
      return imageFromDevcontainer(parseJsonc(text));
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

function notFoundAsNull(err: unknown): null {
  if (err instanceof Deno.errors.NotFound) return null;
  throw err;
}
