// check-release-history — no history record is edited after its release (cli#775).
//
// Usage: deno run --allow-read --allow-run scripts/check-release-history.ts
//
// `specnaut upgrade` prints `.specnaut/release/history/v<X>.md` as what release
// v<X> published. `check-release-commit.ts` compares only the record of the tag
// being cut, so a later edit to an older record would change what every future
// upgrade prints for that release, and nothing would say so. This compares each
// record whose tag exists with `HIGHLIGHTS.md` as that tag published it:
// whitespace-insensitive, as the release gate compares, a missing file read as
// empty. A record whose tag does not exist yet (the release commit, before its
// tag) is not compared. Run in CI, which fetches the tags first.
//
// Exit 0 = every tagged record matches. 1 = a record differs, or no tag is
// visible to compare against.

import { flat } from "./check-release-commit.ts";

const HISTORY = ".specnaut/release/history";
const HIGHLIGHTS = ".specnaut/release/HIGHLIGHTS.md";

async function git(...args: string[]): Promise<{ ok: boolean; out: string }> {
  const out = await new Deno.Command("git", { args, stdout: "piped", stderr: "piped" }).output();
  return { ok: out.success, out: new TextDecoder().decode(out.stdout) };
}

/** What `tag` published as its highlights: `""` when the file did not exist at the tag. */
async function publishedAt(tag: string): Promise<string> {
  // `cat-file -e` answers by exit code, so the absent case does not depend on git's locale.
  if (!(await git("cat-file", "-e", `${tag}:${HIGHLIGHTS}`)).ok) return "";
  const shown = await git("show", `${tag}:${HIGHLIGHTS}`);
  if (!shown.ok) throw new Error(`git show ${tag}:${HIGHLIGHTS} failed`);
  return shown.out;
}

/** Every `v*` tag the checkout can see. */
async function releaseTags(): Promise<Set<string>> {
  const listed = (await git("tag", "--list", "v*")).out.split("\n").map((t) => t.trim());
  return new Set(listed.filter((t) => t !== ""));
}

/** The history records' file names, in name order. */
async function recordNames(): Promise<string[]> {
  const names: string[] = [];
  for await (const e of Deno.readDir(HISTORY)) {
    if (e.isFile && e.name.endsWith(".md")) names.push(e.name);
  }
  return names.sort();
}

/** Each tagged history record that differs from what its tag published, or why none can be compared. */
export async function historyRecordProblems(): Promise<string[]> {
  const tags = await releaseTags();
  const records = await recordNames();
  if (records.length > 0 && tags.size === 0) {
    // A shallow checkout fetches no tag; passing then would compare nothing.
    return [`no v* tag is visible: fetch the tags first, or no record is compared`];
  }
  const problems: string[] = [];
  for (const name of records) {
    const tag = name.slice(0, -".md".length);
    if (tags.has(tag) && !(await matchesItsTag(name, tag))) {
      problems.push(
        `${HISTORY}/${name} differs from ${HIGHLIGHTS} as ${tag} published it — ` +
          `a history record is never edited after its release`,
      );
    }
  }
  return problems;
}

/** Whether record `name` says what `tag` published, whitespace-insensitively. */
async function matchesItsTag(name: string, tag: string): Promise<boolean> {
  const recorded = await Deno.readTextFile(`${HISTORY}/${name}`);
  return flat(recorded) === flat(await publishedAt(tag));
}

if (import.meta.main) {
  const problems = await historyRecordProblems();
  if (problems.length > 0) {
    console.error(`check-release-history: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    Deno.exit(1);
  }
  console.log("check-release-history: ✓ every tagged history record is what its release published");
}
