// cli#705: the ratchet measures a file under the name git stores, byte for
// byte. Read without `-z`, `git diff --name-status` C-quotes a name holding a
// non-ASCII byte, a `"`, a `\`, a tab or a newline, and the quoted string then
// names no blob: the file came out `0 → 0` and passed at any size.
//
// Every case grows a committed file past its limits and requires the refusal
// line naming the file with its real sizes — a line only the path that read
// both blobs can print. A pass, or a `0 → 0`, fails the case.
//
// cli#812: every case runs under the bash PATH finds and under macOS's stock
// /bin/bash 3.2, pinned as twin_runner.ts pins it. On a Mac PATH usually finds
// a newer bash, and `c_quoted`'s byte ranges are read by both.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BASH, FILE, lines, quoted, repo, run, SCRIPT, stage } from "./size_ratchet_fixture.ts";
import { run as child } from "../templates/child_fixture.ts";
import { BASH as STOCK_BASH } from "./twin_runner.ts";

const SHELLS = [...new Set([BASH, STOCK_BASH])];

/** The ratchet run in `dir` by each shell in turn, each result naming its shell. */
async function ratchets(dir: string, ...args: string[]) {
  const out = [];
  for (const bash of SHELLS) out.push({ bash, ...await run(bash, [SCRIPT, ...args], dir) });
  return out;
}

/** Commits `name` at `start` lines in a fresh repo held to target 300, ceiling 400. */
async function committed(name: string, start: number): Promise<string> {
  const dir = await repo(10, FILE(300, 400));
  await stage(dir, name, start);
  await run("git", ["commit", "-q", "-m", "add"], dir);
  return dir;
}

async function assertGrowthRefused(name: string): Promise<void> {
  const dir = await committed(name, 380);
  await stage(dir, name, 390);
  for (const r of await ratchets(dir)) {
    assertEquals(r.code, 1, `${r.bash}: ${r.stdout}${r.stderr}`);
    assertStringIncludes(
      r.stderr,
      `${quoted(name)}: 380 → 390 (target 300, ceiling 400) — over the target and grew`,
    );
  }
}

Deno.test("a file with a non-ASCII name is measured, and refused when it grows", async () => {
  await assertGrowthRefused("naïve.ts");
  assertEquals(quoted("naïve.ts"), '"na\\303\\257ve.ts"'); // as `git -c core.quotepath` shows it
});

// git does not quote a name that only holds spaces: this case does not
// reproduce cli#705, it pins the NUL-delimited read against field splitting.
Deno.test("a file with a space in its name is measured, and refused when it grows", async () => {
  await assertGrowthRefused("my file.ts");
});

// A `"` is not a legal file name character on Windows.
Deno.test({
  name: 'a file with a " in its name is measured, and refused when it grows',
  ignore: Deno.build.os === "windows",
  fn: () => assertGrowthRefused('say"hi".ts'),
});

Deno.test("a renamed file with a non-ASCII name is measured against its old size", async () => {
  const dir = await committed("naïve.ts", 380);
  await run("git", ["mv", "naïve.ts", "café.ts"], dir);
  await Deno.writeTextFile(join(dir, "café.ts"), lines(390));
  await run("git", ["add", "café.ts"], dir);
  for (const r of await ratchets(dir)) {
    assertEquals(r.code, 1, `${r.bash}: ${r.stdout}${r.stderr}`);
    assertStringIncludes(
      r.stderr,
      '"caf\\303\\251.ts": 380 → 390 (target 300, ceiling 400) — over the target and grew',
    );
  }
});

// A name is a pathspec to `git diff`: `*.ts` also matches the binary `!bin.ts`,
// which sorts first, so the per-file binary check skipped the text file.
Deno.test({
  name: "a name that reads as a glob is measured as itself",
  ignore: Deno.build.os === "windows", // `*` is not a legal file name character on Windows
  fn: async () => {
    const dir = await committed("*.ts", 380);
    await Deno.writeTextFile(join(dir, "!bin.ts"), "\0binary\0");
    await stage(dir, "*.ts", 390);
    await run("git", ["add", "!bin.ts"], dir);
    for (const r of await ratchets(dir)) {
      assertEquals(r.code, 1, `${r.bash}: ${r.stdout}${r.stderr}`);
      assertStringIncludes(r.stderr, "*.ts: 380 → 390");
    }
  },
});

// `:1:x.ts` names stage 1 of `x.ts`, not the index entry of `1:x.ts`.
Deno.test({
  name: "a name that reads as an index stage is measured as itself",
  ignore: Deno.build.os === "windows", // `:` is not a legal file name character on Windows
  fn: () => assertGrowthRefused("1:x.ts"),
});

// grep reads a pattern holding a newline as one pattern per line, so a name
// whose second line is a managed path was taken for that managed file and
// passed at any size. The name is staged through the index alone: no file
// system is asked to hold a newline in a name.
Deno.test({
  name: "a name holding a newline is never exempt, even when one line names a managed file",
  // Git for Windows lists no staged entry whose name holds a newline, so the
  // case has nothing to measure there.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const dir = await repo(10, FILE(300, 400));
    await Deno.writeTextFile(
      join(dir, ".specnaut/installed.lock"),
      "version: 2\nentries:\n  managed.ts:\n    sha256: abc\ntemplates_version: 1\n",
    );
    await run("git", ["add", ".specnaut/installed.lock"], dir);
    await run("git", ["commit", "-q", "-m", "lock"], dir);
    const blob = await child("git", ["hash-object", "-w", "--stdin"], dir, {}, lines(900));
    const name = "grown.ts\nmanaged.ts";
    const staged = await child(
      "git",
      ["update-index", "-z", "--index-info"],
      dir,
      {},
      `100644 ${blob.stdout.trim()}\t${name}\0`,
    );
    assertEquals(staged.code, 0, staged.stderr);
    for (const r of await ratchets(dir)) {
      assertEquals(r.code, 1, `${r.bash}: ${r.stdout}${r.stderr}`);
      assertStringIncludes(r.stderr, '"grown.ts\\nmanaged.ts": 0 → 900 (target 300, ceiling 400)');
    }
  },
});

// cli#807: a name is data. Every line that names a file, the refusal, the note on a pass and the
// `--report` line, names it C-quoted as git does, so an escape sequence in it never reaches the
// terminal as one.
Deno.test({
  name: "every line the ratchet prints names a file escaped, never raw",
  ignore: Deno.build.os === "windows", // no Windows file name holds an escape
  fn: async () => {
    const dir = await repo(10, FILE(200, 500));
    await stage(dir, "e\x1b[2J.ts", 600);
    const overs = await ratchets(dir, "--report");
    for (const over of overs) {
      assertEquals(over.code, 1, `${over.bash}: ${over.stdout}${over.stderr}`);
      assertStringIncludes(
        over.stderr,
        '  "e\\033[2J.ts": 0 → 600 (target 200, ceiling 500) — over',
      );
      assertStringIncludes(over.stdout, '  "e\\033[2J.ts": 0 → 600\n');
    }
    await run("git", ["rm", "-q", "--cached", "e\x1b[2J.ts"], dir);
    await stage(dir, "n\x9b1m.ts", 300);
    const notes = await ratchets(dir);
    for (const note of notes) {
      assertEquals(note.code, 0, `${note.bash}: ${note.stdout}${note.stderr}`);
      assertStringIncludes(
        note.stdout,
        '  note: "n\\302\\2331m.ts": 0 → 300 (target 200, ceiling 500)',
      );
    }
    const all = [...overs, ...notes].map((out) => out.stdout + out.stderr).join("");
    assert(!all.includes("\x1b") && !all.includes("\x9b"), all);
  },
});
