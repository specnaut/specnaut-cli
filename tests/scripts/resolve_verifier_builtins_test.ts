import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { docBlock, resolver } from "./resolve_verifier_fixture.ts";
import { fired, inLayout, type Layout } from "./resolve_verifier_layout.ts";

/**
 * The resolve block of `phases/script-gate.md` runs in the session's own shell, which may carry
 * functions and aliases of the user's, and in zsh a `chpwd` hook that runs on every `cd`. Before
 * the PATH is judged, a `cd`, `pwd` or `command` that is one of those could run anything the raw
 * PATH finds, or answer for the builtin; so the block reaches each through `\builtin`, and clears
 * the `chpwd` hooks inside each `$(…)` that changes folder. Every stand-in here leaves a mark.
 */

/** Functions shadowing each builtin the block runs before the PATH is judged; zsh adds hooks. */
function shadows(l: Layout, zsh: boolean): string {
  const mark = (name: string) => `echo ${name} >>'${join(l.tmp, "fired")}'`;
  const fns = ["cd", "pwd", "command"].map((b) => `${b}() { ${mark(b)}; builtin ${b} "$@"; }`);
  if (zsh) {
    fns.push(`chpwd() { ${mark("chpwd")}; }`, `hook() { ${mark("chpwd_functions")}; }`);
    fns.push("chpwd_functions=(hook)");
  }
  return fns.join("\n");
}

Deno.test({
  name: "the resolve block runs no function or zsh hook standing in for cd, pwd or command",
  // Symlinks need a privilege Windows runners lack, and the stub needs POSIX exec bits.
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, shells) => {
      const runs: [string, string[], boolean][] = [[shells.bash, ["-c"], false]];
      if (shells.zsh) runs.push([shells.zsh, ["-f", "-c"], true]);
      else console.warn("zsh is not installed: the block ran under bash only");
      const kept = [join(l.tmp, "outside", "real"), l.tools];
      for (const [shell, flags, zsh] of runs) {
        const code = `${shadows(l, zsh)}\n${docBlock()}`;
        const r = { entries: kept, cwd: l.repo, bash: shells.bash };
        assertEquals(await resolver(shell, flags, code, r), { resolved: l.outside }, shell);
        assertEquals(await fired(l), "", `${shell}: a stand-in ran`);
        // A link outside naming the tree: the folder walk `cd`s through it before it refuses.
        const links = { ...r, entries: [join(l.tmp, "binlink"), ...kept] };
        const want = { refused: "is inside the repository", entry: links.entries[0], exit: 0 };
        assertEquals(await resolver(shell, flags, code, links), want, shell);
        assertEquals(await fired(l), "", `${shell}: a stand-in ran while judging the PATH`);
      }
    }),
});
