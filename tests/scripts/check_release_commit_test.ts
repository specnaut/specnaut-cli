import { assert, assertEquals } from "@std/assert";
import { versionsIn } from "../../scripts/check-release-commit.ts";
import { writeVersions } from "../../scripts/bump-version.ts";

/**
 * The gate between the release commit and `git tag`.
 *
 * v3.0.0 tagged a `feat(...)` commit that a stray `git add -A` had swept the
 * version bump into. The tree happened to be correct, so nothing anywhere
 * reported it — which is the problem: only luck separated "the bump rode along
 * with a feature" from "the tag captured half a feature".
 */

const SCRIPT = new URL("../../scripts/check-release-commit.ts", import.meta.url).pathname;

async function run(cwd: string, tag: string): Promise<{ code: number; err: string }> {
  const out = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-run", SCRIPT, tag],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code: out.code, err: new TextDecoder().decode(out.stderr) };
}

async function git(cwd: string, ...args: string[]) {
  const out = await new Deno.Command("git", { args, cwd, stdout: "null", stderr: "null" }).output();
  assert(out.success, `git ${args.join(" ")} failed`);
}

/** A repo carrying every version file at `version`, committed with `subject`. */
async function repoAt(
  version: string,
  subject: string,
  opts: { desync?: string; staleRef?: string } = {},
) {
  const dir = await Deno.makeTempDir();
  await git(dir, "init", "-q");
  await git(dir, "config", "user.email", "t@t");
  await git(dir, "config", "user.name", "t");
  const json = (v: string) => JSON.stringify({ version: v }, null, 2);
  await Deno.writeTextFile(`${dir}/deno.json`, json(version));
  await Deno.mkdir(`${dir}/src/domain`, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/src/domain/version.ts`,
    `export const VERSION = "${opts.desync ?? version}";\n`,
  );
  for (
    const p of [
      "plugin/.claude-plugin/plugin.json",
      "templates/manifest.json",
      ".codex-plugin/plugin.json",
      ".cursor-plugin/plugin.json",
    ]
  ) {
    await Deno.mkdir(`${dir}/${p.split("/").slice(0, -1).join("/")}`, { recursive: true });
    await Deno.writeTextFile(`${dir}/${p}`, json(version));
  }
  // Two entries per catalog: the second can be left on an older tag, the
  // case a "does any ref match" check would wave through.
  const catalog = JSON.stringify(
    {
      name: "m",
      plugins: [
        { name: "a", source: { ref: `v${version}` } },
        { name: "b", source: { ref: `v${opts.staleRef ?? version}` } },
      ],
    },
    null,
    2,
  );
  for (
    const p of [
      "packaging/marketplace/.claude-plugin/marketplace.json",
      "packaging/marketplace/.github/plugin/marketplace.json",
    ]
  ) {
    await Deno.mkdir(`${dir}/${p.split("/").slice(0, -1).join("/")}`, { recursive: true });
    await Deno.writeTextFile(`${dir}/${p}`, catalog);
  }
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", subject);
  return dir;
}

Deno.test("a correct release commit passes", async () => {
  const dir = await repoAt("3.0.0", "chore: release v3.0.0");
  assertEquals((await run(dir, "v3.0.0")).code, 0);
});

Deno.test("the v3.0.0 mistake is refused — bump swept into a feat commit", async () => {
  const dir = await repoAt("3.0.0", "feat(changelog): let a release lead with what it is about");
  const { code, err } = await run(dir, "v3.0.0");
  assertEquals(code, 1);
  assert(err.includes('expected "chore: release v3.0.0"'), err);
});

Deno.test("version files that disagree are refused", async () => {
  // bump-version.ts writes all six in lockstep, but a hand-edit or a partial
  // revert can desync them — and a binary whose --version disagrees with its
  // templates manifest is a support ticket nobody can reproduce.
  const dir = await repoAt("3.0.0", "chore: release v3.0.0", { desync: "2.1.0" });
  const { code, err } = await run(dir, "v3.0.0");
  assertEquals(code, 1);
  assert(err.includes("src/domain/version.ts declares 2.1.0"), err);
});

Deno.test("a catalog entry left on the previous tag is refused", async () => {
  // The marketplace copies the catalog verbatim at the tag: an entry still
  // pinned to the previous tag installs the previous plugin.
  const dir = await repoAt("3.0.0", "chore: release v3.0.0", { staleRef: "2.9.0" });
  const { code, err } = await run(dir, "v3.0.0");
  assertEquals(code, 1);
  assert(err.includes('b is pinned to "v2.9.0", not v3.0.0'), err);
});

Deno.test("a dirty tree is refused", async () => {
  const dir = await repoAt("3.0.0", "chore: release v3.0.0");
  await Deno.writeTextFile(`${dir}/stray.txt`, "not in the tag");
  const { code, err } = await run(dir, "v3.0.0");
  assertEquals(code, 1);
  assert(err.includes("working tree is dirty"), err);
});

Deno.test("a malformed tag is a usage error, not a release verdict", async () => {
  const dir = await repoAt("3.0.0", "chore: release v3.0.0");
  assertEquals((await run(dir, "3.0.0")).code, 2);
  assertEquals((await run(dir, "latest")).code, 2);
});

Deno.test("versionsIn finds both the JSON field and the TS constant", () => {
  assertEquals(versionsIn('{"version": "1.2.3"}'), ["1.2.3"]);
  assertEquals(versionsIn('export const VERSION = "1.2.3";'), ["1.2.3"]);
  assertEquals(versionsIn('{"version":"1.0.0"}\nVERSION = "2.0.0"'), ["1.0.0", "2.0.0"]);
});

/**
 * The highlights staleness check (#575 follow-up).
 *
 * This check shipped with NO test, which is why its hole survived: it asked
 * whether the last commit touching HIGHLIGHTS.md was an ancestor of the previous
 * tag, so any later commit cleared the flag — including one that changed nothing
 * a reader would see. Observed in this repository: `style: reflow HIGHLIGHTS.md
 * to the fmt width` landed six minutes after v4.1.0 was tagged, and the gate
 * went green over that release's own lead, word for word.
 *
 * The check now compares CONTENT against what was published at the previous tag,
 * whitespace-insensitively — because reflowing is exactly the edit that must not
 * count as rewriting, and `deno fmt` performs it unasked.
 */

const H = ".specnaut/release/HIGHLIGHTS.md";
const LEAD = "**A thing shipped.**\n\nIt does the thing, and here is why that matters to you.\n";

/** A repo tagged at `prev` carrying `lead`, then bumped to `next`. */
async function repoWithHighlights(
  prev: string,
  next: string,
  lead: string,
  after: (dir: string) => Promise<void>,
): Promise<string> {
  const dir = await repoAt(prev.slice(1), `chore: release ${prev}`);
  await Deno.mkdir(`${dir}/.specnaut/release`, { recursive: true });
  await Deno.writeTextFile(`${dir}/${H}`, lead);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "docs(release): the lead");
  await git(dir, "tag", "-a", prev, "-m", prev);
  await after(dir);
  // The bump to `next`, in its own commit, written by the pipeline's own
  // writer: a second list of version files here would drift from the real one.
  await writeVersions(next.slice(1), dir);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", `chore: release ${next}`);
  return dir;
}

Deno.test("highlights already published at the previous tag are refused", async () => {
  const dir = await repoWithHighlights("v1.0.0", "v1.1.0", LEAD, async () => {});
  const { code, err } = await run(dir, "v1.1.0");
  assertEquals(code, 1);
  assert(err.includes("already published at v1.0.0"), err);
});

Deno.test("a whitespace reflow after the tag does NOT make stale highlights fresh", async () => {
  // THE defect. Under the previous provenance check this passed, because the
  // reflow commit is not an ancestor of the tag — and the reader sees the same
  // words either way.
  const dir = await repoWithHighlights("v1.0.0", "v1.1.0", LEAD, async (d) => {
    await Deno.writeTextFile(`${d}/${H}`, LEAD.replace(/, and here is why/, ",\nand here is why"));
    await git(d, "add", "-A");
    await git(d, "commit", "-q", "-m", "style: reflow HIGHLIGHTS.md to the fmt width");
  });
  const { code, err } = await run(dir, "v1.1.0");
  assertEquals(code, 1, `a reflow must not clear the staleness flag:\n${err}`);
  assert(err.includes("already published at v1.0.0"), err);
});

Deno.test("highlights genuinely rewritten for this release are accepted", async () => {
  const dir = await repoWithHighlights("v1.0.0", "v1.1.0", LEAD, async (d) => {
    await Deno.writeTextFile(
      `${d}/${H}`,
      "**Something else entirely shipped.**\n\nDifferent words.\n",
    );
    await git(d, "add", "-A");
    await git(d, "commit", "-q", "-m", "docs(release): the new lead");
  });
  assertEquals((await run(dir, "v1.1.0")).code, 0);
});

Deno.test("an emptied highlights file is accepted — a release with no lead is normal", async () => {
  const dir = await repoWithHighlights("v1.0.0", "v1.1.0", LEAD, async (d) => {
    await Deno.writeTextFile(`${d}/${H}`, "");
    await git(d, "add", "-A");
    await git(d, "commit", "-q", "-m", "docs(release): no lead this time");
  });
  assertEquals((await run(dir, "v1.1.0")).code, 0);
});

Deno.test("highlights absent at the previous tag cannot have been republished", async () => {
  // The file is new since the last release. There is nothing it could repeat.
  const dir = await repoAt("1.0.0", "chore: release v1.0.0");
  await git(dir, "tag", "-a", "v1.0.0", "-m", "v1.0.0");
  await Deno.mkdir(`${dir}/.specnaut/release`, { recursive: true });
  await Deno.writeTextFile(`${dir}/${H}`, LEAD);
  await writeVersions("1.1.0", dir);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "chore: release v1.1.0");
  assertEquals((await run(dir, "v1.1.0")).code, 0);
});
