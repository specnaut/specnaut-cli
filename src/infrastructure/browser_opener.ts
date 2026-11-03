// Opens a URL in the user's default browser (#353 device-flow auth). Injectable
// so the auth flow can be unit-tested without launching a real browser.

export type BrowserOpener = (url: string) => Promise<void>;

/** An http(s) URL in plain characters: all a verification page needs. */
const PLAIN_URL = /^https?:\/\/[A-Za-z0-9._~:\[\]\/?#=&%+,-]+$/;

/**
 * What opens `url` on `os`, or null for anything but a plain http(s) URL: the
 * verification URL comes from the (semi-trusted) Cloud server, and file:// or a
 * custom scheme is not ours to open. A URL that does not open is still printed for
 * the user to copy. Only the normalized form is handed on. On Windows it goes to
 * the URL handler directly.
 */
export function browserCommand(os: string, url: string): [string, string[]] | null {
  let href: string;
  try {
    href = new URL(url).href;
  } catch {
    return null;
  }
  if (!PLAIN_URL.test(href)) return null;
  if (os === "darwin") return ["open", [href]];
  if (os === "windows") return ["rundll32", ["url.dll,FileProtocolHandler", href]];
  return ["xdg-open", [href]];
}

/** Platform launcher: `open` (macOS), the URL handler (Windows), `xdg-open` (Linux). */
export const openInBrowser: BrowserOpener = async (url: string) => {
  const launcher = browserCommand(Deno.build.os, url);
  if (!launcher) return;
  const [cmd, args] = launcher;
  try {
    await new Deno.Command(cmd, { args, stdout: "null", stderr: "null" }).output();
  } catch {
    // Headless / no launcher — the caller already prints the URL to copy.
  }
};
