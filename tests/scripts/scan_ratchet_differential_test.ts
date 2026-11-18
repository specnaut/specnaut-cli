import { assertEquals } from "@std/assert";
import { SCRIPT } from "./size_ratchet_fixture.ts";
import { git, lines, POSIX, repo, scanJson, write } from "../integration/scan_fixture.ts";

/**
 * SC-002: `specnaut scan` and `size-ratchet.sh` agree, both ways, on which files are over a
 * ceiling and which only over a target, on one repository that exercises every exemption: the
 * framework's tree, the lock's entries, `exempt:` globs on the path and on `/path`, `-diff` and
 * `diff` attributes, a NUL sniff, the constitution held under a glob that would exempt it, and
 * generated code: by name, by header (with `diff` set), a header past the 8000-byte window, a
 * `!` entry, and a generated name holding an escape (cli#802). Every file is new since the base,
 * so the ratchet judges each at its full size, and a header marker on a new file is enough for
 * both.
 */

const nul = (n: number) => new TextEncoder().encode(`a\0\n${lines(n - 1)}`);

const LOCK = "version: 2\nharness: claude\ntemplates_version: 0.0.1\nentries:\n" +
  "  .claude/agents/a.md:\n    sha256: x\n    installed_at: '2026-01-01T00:00:00.000Z'\n" +
  "    templates_version: 0.0.1\n";

/** A generated name holding a control character, which no Windows file name can hold. */
const CONTROL: Record<string, string> = { "esc\x1b[2J.gen.ts": lines(900) };

const FILES: Record<string, string | Uint8Array> = {
  ".specnaut/size-limits.yml": 'file:\n  target: 200\n  ceiling: 500\nexempt:\n  - "*.lock"\n' +
    '  - "/gen/*"\n  - "docs/*"\n  - "[0-9]*.txt"\n  - "!kept.gen.ts"\n',
  ".specnaut/installed.lock": LOCK,
  ".gitattributes": "data.txt -diff\nforced.txt diff\nmarked.txt diff\n",
  "big.ts": lines(600),
  "ok.ts": lines(300),
  "small.ts": lines(10),
  "gen/huge.ts": lines(900),
  "src/gen/kept.ts": lines(700),
  "deep/x.lock": lines(900),
  "1.txt": lines(900),
  "a1.txt": lines(260),
  ".specnaut/notes.md": lines(900),
  ".claude/agents/a.md": lines(900),
  ".claude/agents/b.md": lines(510),
  "data.txt": lines(900),
  "bin.dat": nul(900),
  "forced.txt": nul(600),
  "docs/constitution.md": lines(101),
  "docs/other.md": lines(900),
  "src/_generated/api.ts": lines(900),
  "marked.txt": "// @generated\n" + lines(900),
  "longline.ts": "x".repeat(8000) + " @generated\n" + lines(900),
  "kept.gen.ts": lines(900),
  ...(POSIX ? CONTROL : {}),
};

/** The files the fixture plants as generated, by name or by header. */
const GENERATED = ["marked.txt", "src/_generated/api.ts"];

/** The ratchet's verdicts: `— over the ceiling` lines on stderr, `— crosses the target` notes. */
async function ratchetVerdicts(dir: string, base: string) {
  const out = await new Deno.Command("bash", {
    args: [SCRIPT, "--since", base],
    cwd: dir,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr);
  const paths = (suffix: string) =>
    text.split("\n").filter((l) => l.endsWith(suffix)).map((l) =>
      l.trim().replace(/^note: /, "").split(": ")[0]
    ).sort();
  return {
    code: out.code,
    ceiling: paths("— over the ceiling"),
    target: paths("— crosses the target"),
    generated: text.split("\n").filter((l) => l.startsWith("  generated: ")).map((l) =>
      l.slice("  generated: ".length).replace(/ \(.*\)$/, "")
    ).sort(),
  };
}

/** The fixture committed on top of an empty repository; the base the ratchet judges from. */
async function committedFixture(): Promise<{ dir: string; base: string }> {
  const dir = await repo({});
  const base = (await git(dir, "rev-parse", "HEAD")).trim();
  await write(dir, FILES);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "files");
  return { dir, base };
}

/** The scan's file findings at one level, sorted. */
// deno-lint-ignore no-explicit-any
const filesAt = (json: any, level: string): string[] =>
  json.files.items.filter((f: { level: string }) => f.level === level)
    .map((f: { path: string }) => f.path).sort();

Deno.test("SC-002: scan and ratchet agree both ways on what is over a ceiling, and over a target", async () => {
  const { dir, base } = await committedFixture();
  const ratchet = await ratchetVerdicts(dir, base);
  const { json } = await scanJson(dir, "--top", "all");
  assertEquals(ratchet.code, 1);
  assertEquals(filesAt(json, "over_ceiling"), ratchet.ceiling);
  assertEquals(filesAt(json, "over_target"), ratchet.target);
  assertEquals(ratchet.generated, GENERATED);
  assertEquals(json.totals.exempt_by.generated, GENERATED.length);
  // Not agreement on an empty answer: each side found what the fixture plants.
  assertEquals(
    ratchet.ceiling,
    [
      ".claude/agents/b.md",
      "big.ts",
      "docs/constitution.md",
      "forced.txt",
      "kept.gen.ts",
      "longline.ts",
      "src/gen/kept.ts",
      ...(POSIX ? Object.keys(CONTROL) : []),
    ].sort(),
  );
  assertEquals(ratchet.target, ["a1.txt", "ok.ts"]);
});
