import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";
import { UNTRUSTED_GIT_FLAGS } from "../../src/infrastructure/untrusted_git.ts";

/**
 * The merge phase runs no git hook: `phases/merge.md` § Steps is the rule, and this guards the
 * commands its docs spell. The docs are merge.md and every phase document it loads, read from the
 * phase itself, so a document it starts loading is swept without editing this list. A command is
 * any `git …` in a code span or a fenced block; it passes when it carries the flag, or when its
 * subcommand only reads. The list is of reads, not writes, so a subcommand nobody listed fails;
 * `status` is not a read here: it refreshes the index and can run post-index-change.
 */

const PHASES = new URL("../../templates/core/skills/task/phases/", import.meta.url);
const READS = new Set([
  "log",
  "diff",
  "show",
  "rev-parse",
  "rev-list",
  "merge-base",
  "ls-files",
  "cat-file",
  "for-each-ref",
  "ls-remote",
  "ls-tree",
]);

const hooksOff = "core.hooksPath=/dev/null";

async function docs(): Promise<Map<string, string>> {
  const merge = await Deno.readTextFile(new URL("merge.md", PHASES));
  const out = new Map([["merge.md", merge]]);
  for (const [, name] of merge.matchAll(/phases\/([a-z-]+\.md)/g)) {
    out.set(name, await Deno.readTextFile(new URL(name, PHASES)));
  }
  return out;
}

/** Every `git …` command in a code span (a wrapped one included) or a fenced block, as its words. */
function commands(text: string): string[][] {
  const spans = [
    ...[...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].flatMap((m) => m[1].split("\n")),
    ...[...text.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`]+)`/g)].map((m) => m[1]),
  ];
  // A span may chain commands, or prefix one with assignments: each `git` in it is judged.
  return spans.flatMap((s) => s.split(/&&|\|\||;|\$\(/))
    .map((c) =>
      c.trim().split(/\s+/).filter((_w, i, all) =>
        !all.slice(0, i + 1).every((x) => /^[A-Z_]+=/.test(x))
      )
    )
    .filter((w) => w[0] === "git");
}

/** Why `words` breaks the rule, or null: the `-c` pairs first, then the subcommand. */
function violation(words: string[]): string | null {
  let i = 1;
  const config: string[] = [];
  while (words[i] === "-c") {
    config.push(words[i + 1]);
    i += 2;
  }
  const sub = words[i];
  // A bare name ("after every `git rebase`") is a mention, and `<subcommand>` the rule's own form.
  if (sub === undefined || sub.startsWith("<") || words.length === i + 1) return null;
  if (READS.has(sub) || config.includes(hooksOff)) return null;
  return `\`${words.join(" ")}\` runs ${sub} with hooks on`;
}

Deno.test("the flag the docs require is the one the binary's own git passes", () => {
  assert(UNTRUSTED_GIT_FLAGS.includes(hooksOff), "the binary's own git no longer passes it");
});

Deno.test("merge.md states the rule and every phase document it loads is swept", async () => {
  const all = await docs();
  assert(all.get("merge.md")!.includes("**No git hook runs in this phase.**"));
  for (const name of ["merge-squash.md", "epic-fixups.md", "merge-close.md"]) {
    assert(all.has(name), `${name} is not loaded by merge.md`);
  }
});

Deno.test("every git command the merge phase's docs spell runs no hook, or only reads", async () => {
  const found = [...(await docs())].flatMap(([name, text]) =>
    commands(text).map(violation).filter((v) => v !== null).map((v) => `${name}: ${v}`)
  );
  assertEquals(found, []);
});

Deno.test("the sweep sees a write without the flag, and passes reads and mentions", () => {
  const words = (s: string) => s.split(" ");
  assert(violation(words("git rebase refs/remotes/origin/main")) !== null);
  assert(violation(words("git push origin main")) !== null);
  assert(violation(words("git -c core.fsmonitor=false commit -m x")) !== null);
  assertEquals(violation(words(`git -c ${hooksOff} commit -m x`)), null);
  assertEquals(violation(words("git log --oneline")), null);
  assertEquals(violation(words("git rebase")), null);
  assertEquals(commands("run `git push x` then\n```\ngit commit -m y\n```\n").length, 2);
  assertEquals(commands("a `git push\n   origin main` wrapped").map((w) => w.length), [4]);
  const chained = commands("`GIT_EDITOR=true git commit -m x && git push o m`").map((w) =>
    w.join(" ")
  );
  assertEquals(chained, ["git commit -m x", "git push o m"]);
});

/** The git subcommands a script's message could tell someone to run: any other word is prose. */
const SUBCOMMANDS = new Set([
  ...READS,
  ..."push fetch pull remote commit rebase checkout switch merge reset branch tag add rm mv restore"
    .split(" "),
  ..."cherry-pick revert stash worktree am apply clean update-ref symbolic-ref lfs config".split(
    " ",
  ),
]);

/**
 * The git commands a script's line tells someone to run: a `git` after `: ` or an opening quote,
 * up to a quote, a `;` or the end. A report of a call that ran (`git … failed`) tells nobody to run
 * it, and `git` before a word that is no subcommand (`git could`) is prose.
 */
function messageCommands(line: string): string[][] {
  return [...line.matchAll(/(?:: |['`])(git(?: [^'"`;]*)?)/g)]
    .map((m) => m[1].trim().split(/\s+/))
    .filter((w) => !w.includes("failed"))
    .filter((w) =>
      SUBCOMMANDS.has(w.slice(1).find((x, i, all) => x !== "-c" && all[i - 1] !== "-c") ?? "")
    );
}

Deno.test("every git write a shipped script's message names runs no hook", async () => {
  const root = new URL("../../templates/", import.meta.url);
  const found: string[] = [];
  for await (const e of walk(root, { exts: [".sh", ".ps1"], includeDirs: false })) {
    const lines = (await Deno.readTextFile(e.path)).split("\n");
    lines.forEach((line, i) => {
      if (line.trim().startsWith("#")) return;
      for (const v of messageCommands(line).map(violation).filter((v) => v !== null)) {
        found.push(`${relative(fromFileUrl(root), e.path)}:${i + 1}: ${v}`);
      }
    });
  }
  assertEquals(found, []);
});

Deno.test("the message sweep reads instructions, and passes reports and prose", () => {
  const cmds = (s: string) => messageCommands(s).map((w) => w.join(" "));
  assertEquals(cmds(`echo "x: publish it first: git push -u origin main" >&2`), [
    "git push -u origin main",
  ]);
  assertEquals(cmds(`echo "resolve it, 'git rebase --continue', then"`), ["git rebase --continue"]);
  assertEquals(cmds(`refuse "LFS" "git lfs push origin abc failed"`), []);
  assertEquals(cmds(`fail "x: git could not read its blob"`), []);
  assert(violation(messageCommands(`echo "run: git remote set-head origin --auto"`)[0]) !== null);
});
