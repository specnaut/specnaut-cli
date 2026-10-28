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
  const text = await Deno.readLink(path);
  return Deno.build.os === "windows" ? text.replaceAll("\\", "/") : text;
}

/**
 * `Deno.symlink` needs Developer Mode or elevation on Windows. A test whose
 * SETUP makes a link registers as IGNORED there — never short-circuited into a
 * pass — the convention `write_bundle_symlink_test.ts` set on main.
 */
export const WINDOWS = Deno.build.os === "windows";
