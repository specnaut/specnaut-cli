import { join } from "@std/path";
import type { Answer } from "./resolve_verifier_fixture.ts";
import type { Layout } from "./resolve_verifier_layout.ts";

/**
 * The cases of the PATH check's table (resolve_verifier_test.ts), each run by every spelling of
 * the rule and held to the binary's own predicate: PATHs spelled wrong, PATHs reaching into the
 * tree, PATHs kept whole, and trees of their own judged from inside.
 */

/** The answer past the PATH: the `specnaut` it resolves to, or why it is refused. */
type Spec = { resolved: string } | { refused: string };

/**
 * One PATH, where it runs from, and either its first unsafe entry or the answer past the PATH;
 * `want` holds the answers of the spellings the rule alone does not decide.
 */
export type Case = {
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
    // The top is the superproject's, as for a PATH entry, never git's toplevel, the submodule.
    { ...kept("a link outside naming a superproject file, from a submodule", t("outside", "links"),
      { refused: INSIDE }), cwd: l.submodule, project: l.submodule },
    { name: "no specnaut at all", entries: [l.tools], cwd: l.repo, spec: { refused: "is not on the PATH" } },
  ];
}

/**
 * Trees of their own, judged from inside: a linked work tree outside the repository, whose `.git`
 * file is the top from any folder below it; a clone in a submodule, whose `.git` folder ends the
 * walk, so the submodule's folders above it are outside.
 */
function ownTrees(l: Layout): Case[] {
  const sub = join(l.worktree, "sub");
  // deno-fmt-ignore
  return [
    { ...bad(l, "a work tree's folder, from below its top", join(l.worktree, "bin"), INSIDE, sub),
      project: sub },
    { name: "the folder of the submodule a clone is in, from the clone", cwd: l.clone, project: l.clone,
      entries: [join(l.submodule, "bin"), l.tools], spec: { resolved: l.aboveClone } },
  ];
}

/** Every case of the table. */
export function table(l: Layout): Case[] {
  return [...spelledBad(l), ...inTree(l), ...pastThePath(l), ...ownTrees(l)];
}
