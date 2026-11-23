import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, join, relative } from "@std/path";

/**
 * cli#826 — every installer URL a user is given resolves to an installer the
 * project actually serves.
 *
 * The upgrade phase once told users to `curl … https://specnaut.com/install.sh`,
 * a URL that answers 404, while the README gave the working one. Two documents
 * spelled the same instruction differently and nothing compared them; this lock
 * compares every spelling to the one list below.
 *
 * **Only the URL that serves `install.sh` today is listed.** The release asset
 * (`releases/latest/download/install.sh`) joins this list in the change that
 * moves the one-liners to it, once a published release carries the asset —
 * listing it earlier would let a document point at a 404 again.
 */
const SERVED_INSTALLER_URLS: ReadonlySet<string> = new Set([
  "https://raw.githubusercontent.com/specnaut/specnaut-cli/main/install.sh",
]);

const REPO = fromFileUrl(new URL("../../", import.meta.url));

/** What a user reads an install line from: the README and every shipped file. */
const SCOPE = ["README.md", "templates", "plugin"];

/**
 * Any host-qualified path ending in `install.sh`, with or without a scheme, so
 * a bare `specnaut.com/install.sh` is caught as well as a full URL. A shell
 * variable (`$base/install.sh`) has no dotted host and is not an address.
 */
const INSTALLER_URL = /(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+\/[^\s`'"()<>]*install\.sh/g;

async function scopeFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const entry of SCOPE) {
    const path = join(REPO, entry);
    if ((await Deno.stat(path)).isFile) {
      files.push(path);
      continue;
    }
    for await (const f of walk(path, { includeDirs: false })) files.push(f.path);
  }
  return files;
}

async function installerUrls(): Promise<Array<{ file: string; url: string }>> {
  const found: Array<{ file: string; url: string }> = [];
  for (const path of await scopeFiles()) {
    const text = await Deno.readTextFile(path);
    for (const m of text.matchAll(INSTALLER_URL)) {
      // POSIX separators, so the expected paths below hold on Windows too.
      found.push({ file: relative(REPO, path).replaceAll("\\", "/"), url: m[0] });
    }
  }
  return found;
}

Deno.test("every installer URL in the README and the shipped files is one the project serves", async () => {
  const unserved = (await installerUrls())
    .filter(({ url }) => !SERVED_INSTALLER_URLS.has(url))
    .map(({ file, url }) => `${file}: ${url}`);
  assertEquals(unserved, []);
});

Deno.test("the scan reaches the README and both copies of the upgrade phase", async () => {
  // Without this, a scan that matched nothing would pass the test above.
  const files = new Set((await installerUrls()).map(({ file }) => file));
  for (
    const expected of [
      "README.md",
      "templates/core/skills/specnaut/phases/upgrade.md",
      "plugin/skills/specnaut/phases/upgrade.md",
    ]
  ) {
    assert(files.has(expected), `no installer URL found in ${expected}`);
  }
});
