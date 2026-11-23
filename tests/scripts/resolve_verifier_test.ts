import { assertEquals } from "@std/assert";
import { DELIMITER, join } from "@std/path";
import { entryUnsafe, filterGitPath, treeTop } from "../../src/infrastructure/git_path.ts";
import { type Answer, answers } from "./resolve_verifier_fixture.ts";
import { fired, inLayout, type Layout } from "./resolve_verifier_layout.ts";

/**
 * The rule that judges the PATH and resolves `specnaut` before anything runs has three spellings
 * that cannot share code: `phases/script-gate.md` § Resolving the verifier, which runs before any
 * script of the tree is trusted; `_verifier.sh`, which `land-feature.sh` sources; and
 * `_clean-path.sh`, which the three Claude Code hooks, run before any of them, and their launcher
 * source. One table of PATHs runs every script that holds one, and each case must get the same
 * answer from each.
 *
 * A PATH entry that is empty, relative, holds a `.` or `..`, or sits in the tree can supply any
 * command the scripts look up, and the branch under review or being landed can put one there.
 * The doc block and the landing refuse such a PATH, naming its first entry. The hooks run before
 * every tool call of every session, so a refusal would stop work that has nothing to do with a
 * review: they drop the entries instead, and the binary they start is given what is left. The hook
 * that judges a held lock refuses, as the landing does, before handing anything over; so does the
 * one that gates a review's start, for any command that runs `specnaut` from the PATH: it runs on
 * the session's own PATH, dropped entry and all.
 * The binary drops the same entries from the PATH it starts git with (`git_path.ts`): the last test
 * holds its predicate to the same table.
 */

/** The answer past the PATH: the `specnaut` it resolves to, or why it is refused. */
type Spec = { resolved: string } | { refused: string };

/**
 * One PATH, where it runs from, and either its first unsafe entry or the answer past the PATH;
 * `want` holds the answers of the spellings the rule alone does not decide.
 */
type Case = {
  name: string;
  entries: string[];
  cwd: string;
  /** The hooks' project folder, when it is not the repository's top. */
  project?: string;
  bad?: [index: number, why: string];
  spec?: Spec;
  want?: Record<string, Answer>;
  skip?: string;
};

const RELATIVE = "is not an absolute path";
const INSIDE = "is inside the repository";

/** A case whose first entry is bad, followed by a stub outside and the tools folder. */
function bad(l: Layout, name: string, entry: string, why: string, cwd = l.repo): Case {
  return { name, entries: [entry, join(l.tmp, "outside", "real"), l.tools], cwd, bad: [0, why] };
}

/** Entries that are not absolute paths: searched from the working folder, which holds markers. */
function spelledBad(l: Layout): Case[] {
  const o = join(l.tmp, "outside", "real");
  // deno-fmt-ignore
  return [
    bad(l, "a relative entry", "bin", RELATIVE),
    bad(l, "a leading empty entry", "", "is empty", l.bin),
    { name: "a middle empty entry", entries: [o, "", l.tools], cwd: l.bin, bad: [1, "is empty"] },
    { name: "a trailing empty entry", entries: [o, l.tools, ""], cwd: l.bin, bad: [2, "is empty"] },
    bad(l, "a `.` entry", ".", RELATIVE, l.bin),
    bad(l, "a `~` entry, a `~` folder in the working folder", "~/bin", RELATIVE),
    // Nothing left to run `cat`, `git` or `rm` with: the lock must still be found, and refused.
    { name: "one empty entry and nothing else", entries: [""], cwd: l.bin, bad: [0, "is empty"],
      want: { record: { exit: 0 } } },
  ];
}

/** Absolute entries that reach into the tree, however they are spelled. */
function inTree(l: Layout): Case[] {
  const t = (...p: string[]) => join(l.tmp, ...p);
  const blind = l.caseBlind ? undefined : "this file system tells case apart";
  // deno-fmt-ignore
  return [
    bad(l, "an in-repo folder", l.bin, INSIDE),
    { ...bad(l, "a folder of the superproject, from a submodule", l.bin, INSIDE, l.submodule),
      project: l.submodule },
    bad(l, "an in-repo folder not made yet", join(l.repo, "nothere"), INSIDE),
    bad(l, "an in-repo folder through a linked parent", t("alias", "bin"), INSIDE),
    bad(l, "a link outside naming an in-repo folder", t("binlink"), INSIDE),
    bad(l, "a missing tail under a link into the repository", t("alias", "nothere", "bin"), INSIDE),
    // Spelled by hand: join() would fold the `..` away.
    bad(l, "a `..` component", `${l.tmp}/outside/../repo/bin`, "has a . or .. component"),
    bad(l, "a dangling link on the way", t("dangling", "bin"), "names a folder that cannot be entered"),
    bad(l, "an in-repo folder holding a link outside", join(l.repo, "linkbin"), INSIDE),
    // The branch decides where a link of the tree points: spelled in the tree is in the tree.
    bad(l, "an in-repo link naming a folder outside", join(l.repo, "outlink"), INSIDE),
    { ...bad(l, "the repository named in another case", t("REPO", "bin"), INSIDE), skip: blind },
  ];
}

/** PATHs every entry of which is kept: the answer is `specnaut`'s resolution. */
function pastThePath(l: Layout): Case[] {
  const t = (...p: string[]) => join(l.tmp, ...p);
  const kept = (name: string, entry: string, spec: Spec): Case => ({
    name,
    entries: [entry, l.tools],
    cwd: l.repo,
    spec,
  });
  // deno-fmt-ignore
  return [
    kept("a sibling `<repo>-x`", t("repo-x", "bin"), { resolved: l.sibling }),
    kept("a chain of relative links outside", t("outside", "chain"), { resolved: l.outside }),
    kept("outside the repository", t("outside", "real"), { resolved: l.outside }),
    kept("a link outside naming an in-repo file", t("outside", "links"), { refused: INSIDE }),
    { name: "no specnaut at all", entries: [l.tools], cwd: l.repo, spec: { refused: "is not on the PATH" } },
  ];
}

/** The spellings whose answer is another's: zsh runs the doc block, the launcher the lock hook. */
const SAME_AS: Record<string, string> = { zsh: "doc", launch: "lock" };

/** The exit a spelling refuses with; the doc block runs in the session's shell and never exits. */
const REFUSES_WITH: Record<string, number> = {
  doc: 0,
  land: 13,
  landScript: 13,
  lock: 2,
  gate: 2,
  mention: 2,
};

/**
 * What `spelling` must answer. A bad entry: refused by name, a command that merely runs `specnaut`
 * included, as it runs on the session's PATH; the record alone cleans the PATH, its binary run
 * with that entry gone. Otherwise the answer past the PATH, which the hooks give with the PATH
 * their binary saw; with no `specnaut`, the lock stops the call and the others let it through, and
 * the record is never more than a silent exit.
 */
function expected(c: Case, spelling: string, l: Layout): Answer | undefined {
  if (c.want?.[spelling]) return c.want[spelling];
  const cleans = spelling === "mention" || spelling === "record";
  const joined = (entries: string[]) => entries.join(DELIMITER);
  if (c.bad) {
    const [i, why] = c.bad;
    if (spelling !== "record") {
      return { refused: why, entry: c.entries[i], exit: REFUSES_WITH[spelling] };
    }
    return { resolved: l.outside, path: joined(c.entries.filter((_, j) => j !== i)) };
  }
  if (spelling === "landScript") return undefined;
  const spec = c.spec!;
  const hook = cleans || spelling === "lock" || spelling === "gate";
  if ("resolved" in spec) return hook ? { ...spec, path: joined(c.entries) } : spec;
  if (spec.refused === "is not on the PATH" && hook) return { exit: spelling === "lock" ? 2 : 0 };
  if (spelling === "record") return { exit: 0 };
  return { ...spec, exit: REFUSES_WITH[spelling] };
}

Deno.test({
  name: "every spelling of the PATH check and the verifier's resolution answers every case alike",
  // Symlinks need a privilege Windows runners lack, and the stub needs POSIX exec bits.
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, shells) => {
      for (const c of [...spelledBad(l), ...inTree(l), ...pastThePath(l)]) {
        if (c.skip) {
          console.warn(`skipped "${c.name}": ${c.skip}`);
          continue;
        }
        const run = { entries: c.entries, cwd: c.cwd, project: c.project, ...shells };
        const got = await answers(l, run);
        for (const [spelling, answer] of Object.entries(got)) {
          const want = expected(c, SAME_AS[spelling] ?? spelling, l);
          if (want) assertEquals(answer, want, `${spelling}, ${c.name}`);
        }
        assertEquals(await fired(l), "", `a command the PATH entry supplied ran, ${c.name}`);
      }
    }),
});

Deno.test({
  name: "the binary drops from git's PATH exactly the entries the table names, for its reason",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout((l) => {
      for (const c of [...spelledBad(l), ...inTree(l), ...pastThePath(l)]) {
        if (c.skip) continue;
        const top = treeTop(c.cwd);
        const why = c.entries.map((_, i) => i === c.bad?.[0] ? c.bad[1] : undefined);
        assertEquals(c.entries.map((e) => entryUnsafe(e, top)), why, c.name);
        const kept = c.entries.filter((_, i) => why[i] === undefined).join(DELIMITER);
        assertEquals(filterGitPath(c.entries.join(DELIMITER), c.cwd).kept, kept, c.name);
      }
      return Promise.resolve();
    }),
});
