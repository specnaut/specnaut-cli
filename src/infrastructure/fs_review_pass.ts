import { basename, dirname, join } from "@std/path";
import type { GrantedPass, ReviewPass } from "../application/review_ports.ts";
import type { CheckoutState } from "../domain/review_gate.ts";
import { lstatOrNull, realFolder } from "./fs_folder.ts";
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

  async grant(
    baseTip: string,
    checkout: CheckoutState,
    session: string,
    nonce: string,
  ): Promise<void> {
    await realFolder(dirname(this.path));
    const text = `${JSON.stringify({ granted: this.now(), baseTip, checkout, session, nonce })}\n`;
    await replaceFile(this.path, text);
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

/**
 * The pass the file holds; `NaN`, `""` and `null` for what it does not say: a pass that never
 * holds, or one no line carries.
 */
function passOf(text: string): GrantedPass {
  try {
    const parsed: unknown = JSON.parse(text);
    const fields = typeof parsed === "object" && parsed !== null ? parsed : {};
    const { granted, baseTip, checkout, session, nonce } = fields as Record<string, unknown>;
    const said = (v: unknown) => typeof v === "string" ? v : "";
    return {
      granted: typeof granted === "number" ? granted : NaN,
      baseTip: said(baseTip),
      checkout: checkoutOf(checkout),
      session: said(session),
      nonce: said(nonce),
    };
  } catch (err) {
    // Not swallowed: a pass that is not JSON is one that never holds.
    if (!(err instanceof SyntaxError)) throw err;
    return { granted: NaN, baseTip: "", checkout: null, session: "", nonce: "" };
  }
}

/** The checkout a pass names, or `null` when any of its fields is neither a string nor `null`. */
function checkoutOf(v: unknown): CheckoutState | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const { head, ref, reflog } = v as Record<string, unknown>;
  const said = (f: unknown) => typeof f === "string" || f === null;
  if (!said(head) || !said(ref) || !said(reflog)) return null;
  return { head, ref, reflog } as CheckoutState;
}

/**
 * Writes `text` to a file created new beside `path`, then renames it onto `path`: a link there is
 * replaced, never followed, and no reader sees half a file.
 */
export async function replaceFile(path: string, text: string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${crypto.randomUUID()}.tmp`);
  await Deno.writeTextFile(temp, text, { createNew: true, mode: 0o600 });
  try {
    await Deno.rename(temp, path);
  } catch (err) {
    await Deno.remove(temp).catch((cleanup) => {
      console.error(`warning: could not remove ${temp}: ${(cleanup as Error).message}`);
    });
    throw err;
  }
}
