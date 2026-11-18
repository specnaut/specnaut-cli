import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DELIMITER, join } from "@std/path";
import {
  type Answer,
  docBlock,
  hook,
  hookAt,
  HOOKS,
  type Run,
} from "./resolve_verifier_fixture.ts";
import { fired, inLayout, type Layout } from "./resolve_verifier_layout.ts";

/**
 * The spellings of a line review-gate.sh reads past the quoting of resolve_verifier_hooks_test.ts:
 * dollar quoting, a kept backslash-newline, the Windows launcher names, PATH named on the line, a
 * pattern the shell cannot compile, the locale. Markers in the dropped entry: none may fire.
 */

/** The hook's input for a Bash call of `command`, with a description if given. */
const bashCall = (command: string, description?: string) =>
  JSON.stringify({
    cwd: "/work",
    tool_input: { command, ...(description ? { description } : {}) },
  });

/** review-gate.sh's answer to each line, by line, run as `r` says; then no marker may have fired. */
async function gate(l: Layout, r: Run, lines: string[]): Promise<Record<string, Answer>> {
  const out: Record<string, Answer> = {};
  for (const line of lines) out[line] = await hook(l, r, "review-gate.sh", bashCall(line));
  assertEquals(await fired(l), "", "a command the PATH entry supplied ran");
  return out;
}

/** The same `answer` for each line, as `gate` reports them. */
const each = (lines: string[], answer: Answer) =>
  Object.fromEntries(lines.map((line) => [line, answer]));

/** A run whose PATH starts with the tree's `bin`, which the hook drops, and what it then answers. */
const dropping = (l: Layout, bash: string) => ({
  r: { entries: [l.bin, l.tools], cwd: l.repo, bash },
  want: { refused: "is inside the repository", entry: l.bin, exit: 2 },
});

Deno.test({
  name: "with an in-repo PATH entry dropped, dollar quoting hides neither the name nor the start",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      const { r, want } = dropping(l, bash);
      // The shell drops a `$` before a quote; `$'...'` reads escapes that can spell any name.
      const lines = [
        "spec$''naut re$''view start 1",
        "spec$''naut x",
        "$'\\x73'pecnaut x",
        'spec$""naut x',
        '/opt/x/specnaut re$""view start 1',
        // Past a line continuation, which the shell joins before it reads the quote.
        "$\\\n'\\x73'pecnaut x",
        'spec$\\\n""naut x',
      ];
      assertEquals(await gate(l, r, lines), each(lines, want));
      const said = bashCall("ls", "Split on $'\\n'");
      assertEquals(await hook(l, r, "review-gate.sh", said), { exit: 0 }, "a description");
    }),
});

Deno.test({
  name: "with an in-repo PATH entry dropped, a backslash-newline the shell keeps is read as kept",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      const { r, want } = dropping(l, bash);
      // An escaped backslash, then a comment's: the newline after each ends the command, so the
      // next line runs `specnaut`; removed as a line continuation, it would glue the name on.
      const lines = ["echo x\\\\\nspecnaut x", "ls # note\\\nspecnaut x"];
      assertEquals(await gate(l, r, lines), each(lines, want));
    }),
});

Deno.test({
  name: "with an in-repo PATH entry dropped, the Windows launcher names run specnaut too",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      const { r, want } = dropping(l, bash);
      const named = ["specnaut.exe x", "SPECNAUT.CMD x", "x && specnaut.bat verify-scripts"];
      assertEquals(await gate(l, r, named), each(named, want));
      const files = ["ls dist/specnaut.exe", "cat specnaut.exe.sha256"];
      assertEquals(await gate(l, r, files), each(files, { exit: 0 }));
    }),
});

/** Lines that start a review and name PATH bare, so it can be set, by any spelling or letter case. */
const NAMES_PATH = [
  "PATH=./bin:$PATH specnaut review start 1",
  'export PATH="$PWD/bin:$PATH"; specnaut review start 1',
  "env PATH=bin specnaut review start 1",
  "PATH+=:bin; specnaut review start 1",
  "path+=(bin); specnaut review start 1",
  "PATH[0]=bin:$PATH specnaut review start 1",
  "read PATH; specnaut review start 1",
  "PA\\\nTH=bin specnaut review start 1",
  "ls # note\\\nPATH=bin specnaut review start 1",
];

/** Lines that start a review and only read PATH, name another variable, or quote the word. */
const READS_PATH = [
  "MYPATH=x specnaut review start 1",
  'echo "$PATH"; specnaut review start 1',
  'echo "a \\" in PATH"; specnaut review start 1',
  "GOPATH=/go NODE_PATH=lib echo $PATH ${PATH%%:*}; specnaut review start 1",
];

Deno.test({
  name: "a line that starts a review and names PATH is refused, with no entry dropped",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      const r = { entries: [join(l.tmp, "outside", "real"), l.tools], cwd: l.repo, bash };
      const want = {
        refused: "is named on the line that starts a review, where it can be set",
        exit: 2,
      };
      assertEquals(await gate(l, r, NAMES_PATH), each(NAMES_PATH, want));
      // The gate judges these, review-untrusted.md's start among them: the stub records itself.
      const read = [...READS_PATH, `${docBlock()}\nout=$("$sn" review start "1" --expect "abc")`];
      const gated = { resolved: l.outside, path: r.entries.join(DELIMITER) };
      assertEquals(await gate(l, r, read), each(read, gated));
    }),
});

/**
 * review-gate.sh copied, `_clean-path.sh` beside it, into a folder of `l`'s, with the pattern `name`
 * sets made `(`, which `[[ =~ ]]` cannot compile; returns the copy's path.
 */
async function broken(l: Layout, name: string): Promise<string> {
  const dir = join(l.tmp, `hooks-${name}`);
  await Deno.mkdir(dir);
  await Deno.copyFile(join(HOOKS, "_clean-path.sh"), join(dir, "_clean-path.sh"));
  const shipped = await Deno.readTextFile(join(HOOKS, "review-gate.sh"));
  const copy = shipped.replace(new RegExp(`^(\\s*(?:local )?${name}=).*$`, "m"), "$1'('");
  assert(copy !== shipped, `review-gate.sh no longer sets ${name}`);
  await Deno.writeTextFile(join(dir, "review-gate.sh"), copy);
  return join(dir, "review-gate.sh");
}

Deno.test({
  name: "a pattern of review-gate's that the shell cannot compile stops the command",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      const { r } = dropping(l, bash);
      // Each on a line that pattern alone refuses: read as no match, it would be let through.
      const cases = {
        key: "specnaut x",
        word: "specnaut x",
        start: "/opt/x/specnaut review start",
      };
      for (const [name, line] of Object.entries(cases)) {
        const out = await hookAt(l, r, await broken(l, name), bashCall(line));
        assertEquals(out.code, 2, `${name}: ${out.stderr}`);
        assertStringIncludes(out.stderr, "review-gate: a pattern this shell cannot compile", name);
      }
      assertEquals(await fired(l), "", "a command the PATH entry supplied ran");
    }),
});

Deno.test({
  name:
    "with an entry dropped, a command holding `$'` is refused for that, and says how to write it",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      const { r } = dropping(l, bash);
      const out = await hookAt(l, r, join(HOOKS, "review-gate.sh"), bashCall("grep 'x$' f"));
      assertEquals(out.code, 2, out.stderr);
      assertStringIncludes(out.stderr, `PATH entry '${l.bin}' is inside the repository`);
      assertStringIncludes(out.stderr, "the command holds $', whose escapes can spell any name");
      assertEquals(await fired(l), "", "a command the PATH entry supplied ran");
    }),
});

Deno.test({
  name: "with an entry dropped, the session's locale does not decide what the hook matches",
  ignore: Deno.build.os === "windows",
  fn: () =>
    inLayout(async (l, { bash }) => {
      const { r } = dropping(l, bash);
      // A byte no UTF-8 decodes: in a UTF-8 locale, a pattern then matches nothing on the line.
      const [head, tail] = bashCall("@; specnaut x").split("@").map((t) =>
        new TextEncoder().encode(t)
      );
      const bytes = new Uint8Array([...head, 0xff, ...tail]);
      const out = await hookAt(l, r, join(HOOKS, "review-gate.sh"), bytes, { LC_ALL: "C.UTF-8" });
      assertEquals(out.code, 2, out.stderr);
      assertStringIncludes(out.stderr, `PATH entry '${l.bin}' is inside the repository`);
    }),
});
