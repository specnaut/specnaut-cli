import { assertEquals } from "@std/assert";
import { DELIMITER, join } from "@std/path";
import { type Answer, answers, CALL, hook } from "./resolve_verifier_fixture.ts";
import { fired, inLayout, type Layout } from "./resolve_verifier_layout.ts";

/**
 * The rule that judges the PATH and resolves `specnaut` before anything runs has five spellings
 * that cannot share code: `phases/script-gate.md` § Resolving the verifier, which runs before any
 * script of the tree is trusted; `_verifier.sh`, which `land-feature.sh` sources; and the three
 * Claude Code hooks, which run before any of them. One table of PATHs runs all five, and each case
 * must get the same answer from each.
 *
 * A PATH entry that is empty, relative, holds a `.` or `..`, or sits in the tree can supply any
 * command the scripts look up, and the branch under review or being landed can put one there.
 * The doc block and the landing refuse such a PATH, naming its first entry. The hooks run before
 * every tool call of every session, so a refusal would stop work that has nothing to do with a
 * review: they drop the entries instead, and the binary they start is given what is left. The one
 * hook that judges a held lock refuses, as the landing does, before handing anything over.
 */

/** One PATH, where it runs from, and either its first unsafe entry or the answer past the PATH. */
type Case = {
  name: string;
  entries: string[];
  cwd: string;
  bad?: [index: number, why: string];
  spec?: Answer;
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
  ];
}

/** Absolute entries that reach into the tree, however they are spelled. */
function inTree(l: Layout): Case[] {
  const t = (...p: string[]) => join(l.tmp, ...p);
  const blind = l.caseBlind ? undefined : "this file system tells case apart";
  // deno-fmt-ignore
  return [
    bad(l, "an in-repo folder", l.bin, INSIDE),
    bad(l, "an in-repo folder not made yet", join(l.repo, "nothere"), INSIDE),
    bad(l, "an in-repo folder through a linked parent", t("alias", "bin"), INSIDE),
    bad(l, "a link outside naming an in-repo folder", t("binlink"), INSIDE),
    bad(l, "a missing tail under a link into the repository", t("alias", "nothere", "bin"), INSIDE),
    // Spelled by hand: join() would fold the `..` away.
    bad(l, "a `..` component", `${l.tmp}/outside/../repo/bin`, "has a . or .. component"),
    bad(l, "a dangling link on the way", t("dangling", "bin"), "names a folder that cannot be entered"),
    bad(l, "an in-repo folder holding a link outside", join(l.repo, "linkbin"), INSIDE),
    { ...bad(l, "the repository named in another case", t("REPO", "bin"), INSIDE), skip: blind },
  ];
}

/** PATHs every entry of which is kept: the answer is `specnaut`'s resolution. */
function pastThePath(l: Layout): Case[] {
  const t = (...p: string[]) => join(l.tmp, ...p);
  const kept = (name: string, entry: string, spec: Answer): Case => ({
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

/**
 * What `spelling` must answer. A bad entry: refused by name, except by the hooks that clean the
 * PATH, whose binary runs with that entry gone. Otherwise the answer past the PATH, which the hooks
 * give with the PATH their binary saw; with no `specnaut`, the lock stops the call and the others
 * let it through, and the record is never more than a silent exit.
 */
function expected(c: Case, spelling: string, l: Layout): Answer | undefined {
  const cleans = spelling === "gate" || spelling === "record";
  const joined = (entries: string[]) => entries.join(DELIMITER);
  if (c.bad) {
    const [i, why] = c.bad;
    if (!cleans) return { refused: why, entry: c.entries[i] };
    return { resolved: l.outside, path: joined(c.entries.filter((_, j) => j !== i)) };
  }
  if (spelling === "landScript") return undefined;
  const spec = c.spec!;
  const hook = cleans || spelling === "lock";
  if ("resolved" in spec) return hook ? { ...spec, path: joined(c.entries) } : spec;
  if ("refused" in spec && spec.refused === "is not on the PATH" && hook) {
    return { exit: cleans ? 0 : 2 };
  }
  return spelling === "record" ? { exit: 0 } : spec;
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
        const got = await answers(l, { entries: c.entries, cwd: c.cwd, ...shells });
        for (const [spelling, answer] of Object.entries(got)) {
          const want = expected(c, spelling === "zsh" ? "doc" : spelling, l);
          if (want) assertEquals(answer, want, `${spelling}, ${c.name}`);
        }
        assertEquals(await fired(l), "", `a command the PATH entry supplied ran, ${c.name}`);
      }
    }),
});

Deno.test({
  name:
    "with an in-repo PATH entry and no lock, the call runs and the pass is still removed, by the real tools",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      await Deno.remove(join(l.state, "specnaut", "review-lock", "s-1.json"));
      // The markers' folder first: had it been searched, its `git` and `rm` would have run.
      const r = { entries: [l.bin, join(l.tmp, "outside", "real"), l.tools], cwd: l.repo, bash };
      assertEquals(await hook(l, r, "review-lock.sh", CALL), { exit: 0 }, "no lock");
      const pass = join(l.repo, ".git", "specnaut", "review-pass.json");
      await Deno.mkdir(join(l.repo, ".git", "specnaut"));
      await Deno.writeTextFile(pass, "{}\n");
      const ls = '{"tool_input":{"command":"ls"}}';
      assertEquals(await hook(l, r, "review-gate.sh", ls), { exit: 0 }, "a command not a review");
      const left = await Deno.lstat(pass).then(() => true, () => false);
      assertEquals(left, false, "the pass outlived ls");
      assertEquals(await fired(l), "", "a command the PATH entry supplied ran");
    }),
});
