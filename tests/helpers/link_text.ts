import { join } from "@std/path";

/**
 * A link's text as `Deno.readLink` returns it, in `/` form on Windows only.
 *
 * The writer stores a context link's target with `\` on Windows, because that
 * is what Windows itself writes (`denoSymlink` in `fs_link_writer.ts`), so
 * `readLink` returns `..\AGENTS.md` there. A test comparing against the
 * `/`-form target would fail the Windows CI leg for a separator, not a defect.
 *
 * Only Windows is normalised. On macOS and Linux a `\` in a link's text is a
 * literal character, and a link written with one is a different, broken link —
 * so the comparison stays exact there.
 */
export async function readLinkText(path: string): Promise<string> {
  return slashForm(await Deno.readLink(path));
}

/** `text` with Windows' `\` read as `/`; verbatim everywhere else. See `readLinkText`. */
export function slashForm(text: string): string {
  return WINDOWS ? text.replaceAll("\\", "/") : text;
}

/**
 * The test runs on Windows. Kept for what is Windows-specific beyond links —
 * POSIX modes, the `\` link text — never as a stand-in for "cannot link".
 */
export const WINDOWS = Deno.build.os === "windows";

/**
 * Make a link in a test's SETUP the way the writer makes one on this system:
 * `\` text and an explicit `type` on Windows, where links are typed and Deno
 * cannot infer the type of a target that is missing or relative to another
 * directory than the cwd. Verbatim elsewhere.
 */
export function makeLink(
  target: string,
  path: string,
  type: "file" | "dir" = "file",
): Promise<void> {
  return Deno.symlink(WINDOWS ? target.replaceAll("/", "\\") : target, path, { type });
}

/**
 * Whether this run can make a link at all — decided by making one, at module
 * load, so a test whose setup links registers `ignore: !CAN_LINK`: IGNORED
 * where links are refused, never short-circuited into a pass. The windows-latest
 * runner can link; a Windows box without Developer Mode or elevation cannot.
 *
 * Off Windows a refusal is not a property of the system but a broken
 * environment, so it throws instead of quietly ignoring every link test.
 */
export const CAN_LINK: boolean = await probeLink();

async function probeLink(): Promise<boolean> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-link-probe-" });
  try {
    await Deno.writeTextFile(join(dir, "target.md"), "");
    await makeLink("target.md", join(dir, "link.md"));
    return true;
  } catch (err) {
    if (!WINDOWS) throw err;
    console.warn(`link tests ignored — this system refuses links: ${err}`);
    return false;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
