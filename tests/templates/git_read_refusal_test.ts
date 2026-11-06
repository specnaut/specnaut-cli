import { assertEquals, assertStringIncludes } from "@std/assert";
import { gitRead, Plants, twoCommitRepo } from "./git_read_fixture.ts";

/**
 * `git-read.sh` takes data, never a git option: a revision, a path, a count, a
 * pattern. Anything shaped like an option where a revision belongs, a path that
 * leaves the tree, or a form it does not know is refused with exit 2 before git
 * runs, so no option reaches git through an argument.
 */

/** [why, argv] — every one must be refused. */
const REFUSED: [string, string[]][] = [
  ["an unknown form", ["config", "--list"]],
  ["no form", []],
  ["an option as a revision: --output", ["names", "--output=/tmp/x", "HEAD"]],
  ["an option as a revision: -O", ["names", "-Oprogram", "HEAD"]],
  ["an option as a revision: --open-files-in-pager", ["grep", "x", "--open-files-in-pager"]],
  ["an option as a revision: --ext-diff", ["patch", "--ext-diff", "HEAD"]],
  ["an option as a revision: --textconv", ["patch", "HEAD~1", "--textconv"]],
  ["an option as a revision: --show-signature", ["show", "--show-signature", "--stat"]],
  ["an option as a revision: -c", ["log", "-c"]],
  ["an option as a revision: --exec-path", ["base", "--exec-path=/tmp"]],
  ["a shell metacharacter in a revision", ["names", "HEAD;true", "HEAD"]],
  ["a range where a revision belongs", ["names", "HEAD~1..HEAD", "HEAD"]],
  ["a three-dot range", ["log", "HEAD~1...HEAD"]],
  ["a range with an option endpoint", ["log", "--all..HEAD"]],
  ["a count that is not a positive integer", ["log", "HEAD", "0"]],
  ["a count that is an option", ["log", "HEAD", "--all"]],
  ["a show mode it does not know", ["show", "HEAD", "--format=%G?"]],
  ["an absolute path", ["files", "/etc"]],
  ["a parent-directory path", ["patch", "HEAD~1", "HEAD", "../outside"]],
  ["a path with a middle parent segment", ["grep", "x", "HEAD", "src/../.."]],
  ["a drive-letter path", ["files", "C:/Windows"]],
  ["an empty pattern", ["grep", "", "HEAD"]],
  ["too many arguments", ["names", "HEAD~1", "HEAD", "notes.txt"]],
  ["a revision whose second line is an option", ["names", "HEAD\n--output=x", "HEAD"]],
  ["a range whose second line is an option", ["log", "HEAD~1..HEAD\n--all"]],
  ["a count with a second line", ["log", "HEAD", "1\n2"]],
  ["a path with a second line", ["files", "notes.txt\n.."]],
  ["a manifests output path outside the tree", ["manifests", "HEAD~1", "HEAD", "/tmp/m.diff"]],
];

for (const [why, argv] of REFUSED) {
  Deno.test(`git-read refuses ${why}`, async () => {
    const dir = await twoCommitRepo();
    try {
      const r = await gitRead(argv, dir);
      assertEquals(r.code, 2, `exit for ${JSON.stringify(argv)}:\n${r.stdout}${r.stderr}`);
      assertEquals(r.stdout, "", "a refused form prints nothing on stdout");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
}

Deno.test("git-read says what it refused, so a caller can tell a refusal from git's own error", async () => {
  const dir = await twoCommitRepo();
  try {
    const r = await gitRead(["names", "--output=/tmp/x", "HEAD"], dir);
    assertStringIncludes(r.stderr, "git-read: refused: not a revision: --output=/tmp/x");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("git-read writes no file an option names, even through a revision slot", async () => {
  const dir = await twoCommitRepo();
  const p = await Plants.create();
  try {
    const target = `${p.dir}/written`;
    await gitRead(["names", `--output=${target}`, "HEAD"], dir);
    await gitRead(["patch", "HEAD~1", "HEAD", `--output=${target}`], dir);
    const names: string[] = [];
    for await (const e of Deno.readDir(p.dir)) names.push(e.name);
    assertEquals(names, [], "an --output argument reached git as an option");
  } finally {
    await Deno.remove(dir, { recursive: true });
    await p.remove();
  }
});
