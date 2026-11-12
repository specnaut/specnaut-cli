import { dirname, join } from "@std/path";
import type { GrantedPass, ReviewPass } from "../application/review_ports.ts";
import { firstLine } from "./git_text.ts";
import { UntrustedGit } from "./untrusted_git.ts";

/**
 * The review pass as a file: `<git dir>/specnaut/review-pass.json`, the worktree's own git
 * directory, where no tracked, untracked or ignored file of a branch can land. Written to a file
 * created new beside it, then renamed onto its name, which replaces a link rather than following
 * it; read only as a regular file, and removed as it is taken.
 */
export class FsReviewPass implements ReviewPass {
  private constructor(readonly path: string, readonly now: () => number) {}

  /** The pass of the repository `cwd` is in, or `null` outside one. */
  static async open(cwd: string, now: () => number = Date.now): Promise<FsReviewPass | null> {
    const out = await new UntrustedGit(cwd).call("rev-parse", ["--absolute-git-dir"]);
    if (out.code !== 0) return null;
    return new FsReviewPass(join(firstLine(out.stdout), "specnaut", "review-pass.json"), now);
  }

  async grant(baseTip: string): Promise<void> {
    const dir = dirname(this.path);
    await realFolder(dir);
    const temp = join(dir, `.review-pass.${crypto.randomUUID()}.tmp`);
    const text = `${JSON.stringify({ granted: this.now(), baseTip })}\n`;
    await Deno.writeTextFile(temp, text, { createNew: true, mode: 0o600 });
    try {
      await Deno.rename(temp, this.path);
    } catch (err) {
      await Deno.remove(temp).catch((cleanup) => {
        console.error(`warning: could not remove ${temp}: ${(cleanup as Error).message}`);
      });
      throw err;
    }
  }

  async revoke(): Promise<void> {
    try {
      await Deno.remove(this.path);
    } catch (err) {
      // Not swallowed: no pass to remove is the outcome sought.
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }

  async take(): Promise<GrantedPass | null> {
    const info = await lstatOrNull(this.path);
    if (info === null) return null;
    if (!info.isFile) throw new Error(`${this.path} is not a regular file`);
    const text = await Deno.readTextFile(this.path);
    await Deno.remove(this.path);
    return passOf(text);
  }
}

/** The pass the file holds; `NaN` and `""` for what it does not say: a pass that never holds. */
function passOf(text: string): GrantedPass {
  try {
    const { granted, baseTip } = JSON.parse(text) as { granted?: unknown; baseTip?: unknown };
    return {
      granted: typeof granted === "number" ? granted : NaN,
      baseTip: typeof baseTip === "string" ? baseTip : "",
    };
  } catch (err) {
    // Not swallowed: a pass that is not JSON is one that never holds.
    if (!(err instanceof SyntaxError)) throw err;
    return { granted: NaN, baseTip: "" };
  }
}

/** `dir` made where missing; one existing as anything but a folder, a link included, is refused. */
async function realFolder(dir: string): Promise<void> {
  const info = await lstatOrNull(dir);
  if (info === null) await Deno.mkdir(dir, { mode: 0o700 });
  else if (!info.isDirectory) throw new Error(`${dir} is not a folder: a link is not followed`);
}

async function lstatOrNull(path: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.lstat(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}
