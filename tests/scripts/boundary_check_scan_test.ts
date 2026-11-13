// `boundary-check.sh` reads the repository it runs in, whatever git variables it inherits; it
// reads every file byte for byte, a NUL or a byte the locale cannot decode included; and a
// conflicted path is read when any of its stages is a regular file.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { BOUNDARIES_CONFIG_PATH } from "../../src/domain/constitution_paths.ts";
import { IDENTITY, run } from "../templates/child_fixture.ts";
import { bashScript } from "./explicit_head_fixture.ts";

const SCRIPT = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/boundary-check.sh", import.meta.url),
);
const CONFIG = "domain:\n  - 'src/domain'\nforbid:\n  - 'import .* from \"web-framework\"'\n";
const IMPORT = 'import x from "web-framework";\n';
const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => typeof p === "string" ? [...enc(p)] : p));

async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await run("git", args, cwd, IDENTITY);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

const made: string[] = [];

/** `fn`, then every repository it made removed, whatever it threw. */
const scoped = (fn: () => Promise<void>) => async () => {
  try {
    await fn();
  } finally {
    for (const dir of made.splice(0)) await Deno.remove(dir, { recursive: true });
  }
};

/** A committed repository holding the config and `files`, each written byte for byte. */
async function repo(files: Record<string, Uint8Array>): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "boundary-scan-" });
  made.push(dir);
  await git(dir, "init", "-q");
  const all = { [BOUNDARIES_CONFIG_PATH]: enc(CONFIG), "README.md": enc("a project\n"), ...files };
  for (const [path, content] of Object.entries(all)) {
    await Deno.mkdir(dirname(join(dir, path)), { recursive: true });
    await Deno.writeFile(join(dir, path), content);
  }
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "init");
  return dir;
}

const check = (dir: string, env: Record<string, string> = {}) => bashScript(SCRIPT, [], dir, env);

/**
 * Latin-1 `é` inside the span the pattern's `.*` covers: not UTF-8, so under a UTF-8 locale the
 * `.` cannot match it and the import goes unreported.
 */
const LATIN1 = bytes("import caf", [0xe9], ' from "web-framework";\n');
const UTF8 = { LC_ALL: "C.UTF-8", LANG: "C.UTF-8" };

/**
 * The control: does plain grep, as the script runs it, miss the import under that locale? GNU grep
 * does; BSD grep matches the byte anyway, so on such a host the case below could not fail and is
 * skipped.
 */
async function localeHidesLine(): Promise<boolean> {
  const dir = await Deno.makeTempDir({ prefix: "boundary-locale-" });
  try {
    await Deno.writeFile(join(dir, "a.ts"), LATIN1);
    const r = await run("grep", ["-E", "-a", "-q", "import .* from", "a.ts"], dir, UTF8);
    return r.code !== 0;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
const LOCALE_HIDES = Deno.build.os !== "windows" && await localeHidesLine();

Deno.test(
  "boundary check: a GIT_DIR it inherits does not point it at another repository",
  scoped(async () => {
    const dir = await repo({ "src/domain/a.ts": enc(IMPORT) });
    const other = await repo({ "src/other.ts": enc("x\n") });
    const env = { GIT_DIR: join(other, ".git") };
    const plain = await run("git", ["ls-files", "src/domain"], dir, env);
    assertEquals(plain.stdout, "", "the control: git follows the variable");
    const r = await check(dir, env);
    assertEquals(r.code, 1, r.stdout + r.stderr);
    assertStringIncludes(r.stderr, "src/domain/a.ts:1: ");
  }),
);

Deno.test(
  "boundary check: a forbidden import beside a NUL is found",
  scoped(async () => {
    const dir = await repo({
      "src/domain/a.ts": enc("export const a = 1;\n"),
      "src/domain/b.ts": bytes([0], "\n", IMPORT),
      "src/domain/c.ts": bytes(IMPORT.trimEnd(), [0], "\n"),
    });
    const r = await check(dir);
    assertEquals(r.code, 1, r.stdout + r.stderr);
    assertStringIncludes(r.stderr, "2 forbidden import(s) in 3 file(s)");
    assertStringIncludes(r.stderr, "src/domain/b.ts:2: ");
    assertStringIncludes(r.stderr, "src/domain/c.ts:1: ");
  }),
);

Deno.test({
  name: "boundary check: a byte the locale cannot decode does not hide a line",
  // Skipped where plain grep finds the line under that locale: the host cannot show the miss.
  ignore: !LOCALE_HIDES,
  fn: scoped(async () => {
    const dir = await repo({ "src/domain/a.ts": LATIN1 });
    const r = await check(dir, UTF8);
    assertEquals(r.code, 1, r.stdout + r.stderr);
    assertStringIncludes(r.stderr, "src/domain/a.ts:1: ");
  }),
});

Deno.test({
  name: "boundary check: a conflicted path whose first stage is a link is read by a later one",
  ignore: Deno.build.os === "windows",
  fn: scoped(async () => {
    const dir = await repo({ "src/domain/keep.txt": enc("") });
    const link = await git(dir, "hash-object", "-w", "--stdin");
    const file = await git(dir, "hash-object", "-w", "src/domain/keep.txt");
    const path = "src/domain/a.ts";
    const info =
      [`120000 ${link} 1\t${path}`, `100644 ${file} 2\t${path}`, `100644 ${file} 3\t${path}`]
        .join("\n") + "\n";
    const r0 = await run("git", ["update-index", "--index-info"], dir, IDENTITY, info);
    assertEquals(r0.code, 0, r0.stderr);
    await Deno.writeTextFile(join(dir, path), IMPORT);
    const r = await check(dir);
    assertEquals(r.code, 1, r.stdout + r.stderr);
    assertStringIncludes(r.stderr, `${path}:1: `);
  }),
});

// A commit hook runs it beside an index that lists a path the work tree lacks: removed after it
// was staged, or outside a sparse checkout. No file passes unread, so that path is read as the
// blob the index records: a forbidden import staged and then deleted from disk is still reported.
Deno.test(
  "boundary check: a path the index lists but the work tree lacks is read from its staged blob",
  scoped(async () => {
    const dir = await repo({ "src/domain/a.ts": enc("export const a = 1;\n") });
    await Deno.writeTextFile(join(dir, "src/domain/b.ts"), IMPORT);
    await git(dir, "add", "src/domain/b.ts");
    await Deno.remove(join(dir, "src/domain/b.ts"));
    const r = await check(dir);
    assertEquals(r.code, 1, r.stdout + r.stderr);
    assertStringIncludes(r.stderr, "src/domain/b.ts:1: ");
    assertStringIncludes(r.stderr, "1 forbidden import(s) in 2 file(s)");
  }),
);
