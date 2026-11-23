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
 * Only the release asset is listed: the copy each release publishes and attests.
 * The copy on `main` still works for projects scaffolded before, but no
 * document may send a new user to it.
 */
const SERVED_INSTALLER_URLS: ReadonlySet<string> = new Set([
  "https://github.com/specnaut/specnaut-cli/releases/latest/download/install.sh",
  "https://github.com/specnaut/specnaut-cli/releases/download/vX.Y.Z/install.sh",
]);

const REPO = fromFileUrl(new URL("../../", import.meta.url));

/**
 * What a user reads an install line from: the README, SECURITY.md, the
 * installer's own usage header, and every shipped file.
 */
const SCOPE = ["README.md", "SECURITY.md", "install.sh", "templates", "plugin"];

/**
 * Any host-qualified path whose last segment is `install` or `install.<ext>`
 * (`install.sh`, `install.ps1`, a bare `specnaut.com/install`), with or without
 * a scheme. The left boundary keeps the match from starting mid-word; a shell
 * variable (`$base/install.sh`) has no dotted host and is not an address.
 */
const INSTALLER_URL =
  /(?<![\w.\/-])(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+\/(?:[^\s`'"()<>]*\/)?install(?:\.\w+)?(?![\w\/-]|\.\w)/g;

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
      "install.sh",
      "templates/core/skills/specnaut/phases/upgrade.md",
      "plugin/skills/specnaut/phases/upgrade.md",
    ]
  ) {
    assert(files.has(expected), `no installer URL found in ${expected}`);
  }
});

Deno.test("the URL pattern catches installers that do not end in install.sh, and only whole URLs", () => {
  const urls = (text: string) => [...text.matchAll(INSTALLER_URL)].map((m) => m[0]);
  assertEquals(urls("curl https://specnaut.com/install | sh"), ["https://specnaut.com/install"]);
  assertEquals(urls("iwr example.com/x/install.ps1 | iex"), ["example.com/x/install.ps1"]);
  assertEquals(urls("see a.b/c/install.sh."), ["a.b/c/install.sh"]);
  assertEquals(urls("x.y/installation and x.y/install/more"), []);
});
