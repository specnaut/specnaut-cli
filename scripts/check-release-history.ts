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
// empty. Only the highest record may lack its tag (the release commit, before
// its tag): any other record without one names a deleted tag, and is refused.
// Run in CI, which fetches the tags first.
//
// Exit 0 = every record matches its tag. 1 = a record differs or lacks its
// tag, no tag is visible to compare against, or git failed.

import { SemVer } from "../src/domain/release.ts";
import { flat } from "./check-release-commit.ts";

const HISTORY = ".specnaut/release/history";
const HIGHLIGHTS = ".specnaut/release/HIGHLIGHTS.md";

/** `git <args>`'s output; throws with git's own message when it fails. */
async function git(...args: string[]): Promise<string> {
  const out = await new Deno.Command("git", { args, stdout: "piped", stderr: "piped" }).output();
  if (!out.success) {
    const said = new TextDecoder().decode(out.stderr).trim();
    throw new Error(`git ${args.join(" ")} failed: ${said}`);
  }
  return new TextDecoder().decode(out.stdout);
}

/** What `tag` published as its highlights: `""` when the file did not exist at the tag. */
async function publishedAt(tag: string): Promise<string> {
  // `ls-tree` lists nothing for an absent path and fails only when git does, so
  // a git failure is never read as a missing file, whatever git's locale.
  if ((await git("ls-tree", "--name-only", tag, "--", HIGHLIGHTS)).trim() === "") return "";
  return await git("show", `${tag}:${HIGHLIGHTS}`);
}

/** Every `v*` tag the checkout can see. */
async function releaseTags(): Promise<Set<string>> {
  const listed = (await git("tag", "--list", "v*")).split("\n").map((t) => t.trim());
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

/** Each history record that differs from what its tag published or lacks its tag, or why none can be compared. */
export async function historyRecordProblems(): Promise<string[]> {
  const tags = await releaseTags();
  const records = await recordNames();
  if (records.length > 0 && tags.size === 0) {
    // A shallow checkout fetches no tag; passing then would compare nothing.
    return [`no v* tag is visible: fetch the tags first, or no record is compared`];
  }
  const cut = beingCut(records, tags);
  const problems: string[] = [];
  for (const name of records) {
    const tag = name.slice(0, -".md".length);
    if (!tags.has(tag)) {
      if (name !== cut) {
        problems.push(
          `${HISTORY}/${name} has no tag ${tag}, and only the release being cut may lack one`,
        );
      }
    } else if (!(await matchesItsTag(name, tag))) {
      problems.push(
        `${HISTORY}/${name} differs from ${HIGHLIGHTS} as ${tag} published it — ` +
          `a history record is never edited after its release`,
      );
    }
  }
  return problems;
}

/**
 * The record of the release being cut: the highest record by version, when it
 * has no tag yet. A lower record without a tag is never this release, so its
 * tag was deleted; exempting every untagged record let that pass unseen.
 */
function beingCut(records: string[], tags: Set<string>): string | undefined {
  const versioned = records.flatMap((name) => {
    const version = SemVer.tryParse(name.slice(1, -".md".length));
    return version === null ? [] : [{ name, version }];
  });
  const highest = versioned.sort((a, b) => b.version.compare(a.version))[0]?.name;
  return highest !== undefined && !tags.has(highest.slice(0, -".md".length)) ? highest : undefined;
}

/** Whether record `name` says what `tag` published, whitespace-insensitively. */
async function matchesItsTag(name: string, tag: string): Promise<boolean> {
  const recorded = await Deno.readTextFile(`${HISTORY}/${name}`);
  return flat(recorded) === flat(await publishedAt(tag));
}

if (import.meta.main) {
  const problems = await historyRecordProblems().catch((e: Error) => [e.message]);
  if (problems.length > 0) {
    console.error(`check-release-history: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    Deno.exit(1);
  }
  console.log("check-release-history: ✓ every history record is what its release published");
}
