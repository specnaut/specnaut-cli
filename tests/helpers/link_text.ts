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

/**
 * Registers a test whose fixture links and whose subject is containment —
 * where a link leads, judged against the kernel. IGNORED on Windows, never
 * short-circuited inside the body: a test that returns early reports as
 * PASSED, and a green that never ran is the failure containment exists to
 * remove.
 *
 * Windows, not `!CAN_LINK`: these tests have never run there. The
 * windows-latest runner can link, but it is recorded resolving `..` in a link
 * lexically (`write_bundle_link_test.ts`) where they pin the POSIX walk, so
 * moving them is a measurement still to make. **Containment is not covered on
 * Windows**; that is stated rather than hidden. A test that pins only what
 * Windows shares with POSIX registers `ignore: !CAN_LINK` instead.
 */
export function symlinkTest(name: string, fn: () => Promise<void>): void {
  Deno.test({ name, ignore: WINDOWS, fn });
}

/** Every permission Deno has: granted all at once, it stops checking paths (see below). */
const EVERY_PERMISSION = ["read", "write", "net", "env", "run", "ffi", "sys", "import"] as const;

/**
 * Refuses to load under every permission at once (`deno test -A`), so a link
 * test cannot pass there in silence (cli#690).
 *
 * With every permission granted, Deno hands a path to the kernel as written;
 * with any one withheld, it normalises `..` lexically first. Measured with Deno
 * 2.9.8 on macOS, `proj/s` linked outside the project: reading
 * `proj/s/../real.md` returns the file inside under the task's flags and the
 * one outside under `-A`. The binary withholds `sys` and `import`, so only the
 * scoped run is the binary's behaviour, and a link test green under `-A` has
 * proved something about a program nobody ships.
 */
function refuseEveryPermission(): void {
  const granted = (name: (typeof EVERY_PERMISSION)[number]) =>
    Deno.permissions.querySync({ name }).state === "granted";
  if (!EVERY_PERMISSION.every(granted)) return;
  throw new Error(
    "link tests refuse to run with every permission granted (-A): Deno then stops " +
      "normalising paths, so they would not test what the binary does. Run them with " +
      "`deno task test`, or `deno test --allow-read --allow-write --allow-run --allow-env <file>`.",
  );
}
refuseEveryPermission();

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
