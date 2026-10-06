import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * The marketplace catalogs this repository publishes (#633).
 *
 * The catalog used to be hand-written in the marketplace repository, and the
 * only thing any check read from it was a version number. It had no `name`, no
 * `owner`, and a `source` in no dialect Claude Code accepts, so `/plugin
 * install` installed nothing on every release while the channel reported
 * healthy. The catalogs now live here, beside what they list, and the
 * marketplace copies them verbatim at the release tag.
 *
 * Two files, because the two installers read different dialects for "a
 * subdirectory of a GitHub repository":
 *
 *   - Claude Code (`.claude-plugin/marketplace.json`) — `git-subdir` with
 *     `url` + `path`. A `github` source has no `path` there; given one, it
 *     installs the repository root, which here is an empty plugin.
 *   - Copilot CLI (`.github/plugin/marketplace.json`, which it reads first) —
 *     `github` with `repo` + `path`. It has no `git-subdir`.
 *
 * Both were verified by installing from each dialect in a clean Claude Code
 * config: `git-subdir` loaded 27 skills and 16 agents, `github` + `path` zero.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const CLAUDE = "packaging/marketplace/.claude-plugin/marketplace.json";
const COPILOT = "packaging/marketplace/.github/plugin/marketplace.json";
const REPO = "specnaut/specnaut-cli";

type Entry = {
  name: string;
  description?: string;
  source: { source: string; url?: string; repo?: string; path?: string; ref?: string };
};
type Catalog = { name?: string; owner?: { name?: string }; plugins: Entry[] };

const read = async (p: string): Promise<Catalog> =>
  JSON.parse(await Deno.readTextFile(`${ROOT}${p}`));
const version = async (): Promise<string> =>
  JSON.parse(await Deno.readTextFile(`${ROOT}deno.json`)).version;

async function manifestAt(path: string): Promise<{ name: string }> {
  return JSON.parse(await Deno.readTextFile(`${ROOT}${path}/.claude-plugin/plugin.json`));
}

for (const file of [CLAUDE, COPILOT]) {
  Deno.test(`${file} carries the fields both installers require`, async () => {
    const c = await read(file);
    assertEquals(c.name, "specnaut-marketplace");
    assert(c.owner?.name, "owner.name is required");
    assert(c.plugins.length > 0, "a catalog with no plugins");
  });

  Deno.test(`${file} pins every entry to this release's tag`, async () => {
    const tag = `v${await version()}`;
    for (const e of (await read(file)).plugins) {
      assertEquals(e.source.ref, tag, `${e.name} is pinned to ${e.source.ref}, not ${tag}`);
    }
  });

  Deno.test(`${file} points every entry at a plugin of the same name in this repo`, async () => {
    for (const e of (await read(file)).plugins) {
      assert(e.source.path, `${e.name} has no path`);
      assert(!e.source.path.includes(".."), `${e.name} path escapes the repo`);
      const m = await manifestAt(e.source.path);
      assertEquals(m.name, e.name, `entry ${e.name} installs a plugin named ${m.name}`);
    }
  });
}

Deno.test("the Claude Code catalog uses git-subdir sources on this repository", async () => {
  for (const e of (await read(CLAUDE)).plugins) {
    assertEquals(e.source.source, "git-subdir", `${e.name}: Claude Code needs git-subdir`);
    assertEquals(e.source.url, `https://github.com/${REPO}.git`);
  }
});

Deno.test("the Copilot CLI catalog uses github sources with a path", async () => {
  for (const e of (await read(COPILOT)).plugins) {
    assertEquals(e.source.source, "github", `${e.name}: Copilot CLI has no git-subdir`);
    assertEquals(e.source.repo, REPO);
  }
});

Deno.test("every Copilot CLI entry is also offered to Claude Code, at the same path", async () => {
  const claude = new Map((await read(CLAUDE)).plugins.map((e) => [e.name, e.source.path]));
  for (const e of (await read(COPILOT)).plugins) {
    assertEquals(claude.get(e.name), e.source.path, `${e.name} differs between the catalogs`);
  }
});
