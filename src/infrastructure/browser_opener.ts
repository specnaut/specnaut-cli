// Opens a URL in the user's default browser (#353 device-flow auth). Injectable
// so the auth flow can be unit-tested without launching a real browser.

export type BrowserOpener = (url: string) => Promise<void>;

/** Platform launcher: `open` (macOS), `start` (Windows), `xdg-open` (Linux). */
export const openInBrowser: BrowserOpener = async (url: string) => {
  // Only open well-formed http(s) URLs. The verification URL comes from the
  // (semi-trusted) Cloud server response; refusing other schemes / malformed
  // values blocks argument-injection into the platform launcher (esp. Windows
  // `cmd /c start`) and file:// / custom-scheme abuse.
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
  } catch {
    return;
  }
  const os = Deno.build.os;
  const [cmd, args] = os === "darwin"
    ? ["open", [url]]
    : os === "windows"
    ? ["cmd", ["/c", "start", "", url]]
    : ["xdg-open", [url]];
  try {
    await new Deno.Command(cmd as string, {
      args: args as string[],
      stdout: "null",
      stderr: "null",
    }).output();
  } catch {
    // Headless / no launcher — the caller already prints the URL to copy.
  }
};
