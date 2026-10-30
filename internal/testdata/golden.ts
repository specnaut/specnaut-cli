// Differential goldens for the Go port (cli#662): the TypeScript functions the
// Go packages reimplement, run on one case list, so a Go unit test is judged
// against the implementation rather than against a reading of it.
//
// Regenerate after changing a case or the TypeScript side (CI regenerates
// them and fails on any diff, so a stale golden cannot land):
//   deno run --allow-read --allow-write internal/testdata/golden.ts
//
// Each golden is JSON Lines — one case per line — so a file stays as long as
// its case list, and `deno fmt` (which does not read .jsonl) never re-wraps it.
import { parseArgs } from "../../src/cli/parser.ts";
import { parseLock, RemovedHarnessError } from "../../src/domain/installed_lock.ts";
import { assertSafeDestination } from "../../src/domain/template.ts";
import { retiredConfigNotices } from "../../src/application/upgrade_retired_notices.ts";
import type { FsReader } from "../../src/application/ports.ts";
import { AGENT_FOLDERS } from "../../src/domain/agent_folders.ts";

const argv: string[][] = [
  [],
  ["bogus"],
  ["42"],
  ["0042"],
  ["1e3"],
  ["0x10"],
  ["0o17"],
  ["0b101"],
  ["-0"],
  ["00"],
  [".5"],
  ["5."],
  ["+5"],
  [" 7 "],
  ["1_000"],
  ["1e400"],
  ["1e21"],
  ["1e-7"],
  ["0.000001"],
  ["123456789012345678901234"],
  ["Infinity"],
  ["-5"],
  ["-"],
  [" 5"],
  [""],
  ["--bogus"],
  ["--bogus", "init"],
  ["--bogus", "-x"],
  ["--bogus", "--", "init"],
  ["-x"],
  ["-x", "init"],
  ["-x", "-init"],
  ["-x", "---init"],
  ["-x", "-"],
  ["cloud", "bogus", "--api-url", "http://127.0.0.1:9"],
  ["--ai=claude", "bogus"],
  ["cloud"],
  ["gate"],
  ["gate", "bogus"],
  ["spec"],
  ["spec", "bogus"],
  ["spec", "push", "0x1"],
  ["cloud", "0x1"],
  ["gate", "1e3"],
  ["init", "--ai", "bogus"],
  ["init", "--ai", "windsurf"],
  ["init", "--ai=windsurf"],
  ["init", "--ai"],
  ["init", "--ai="],
  ["init", "--ai", "--here"],
  ["init", "--ai", "true"],
  ["init", "--ai", "007"],
  ["init", "--ai", "claude", "--ai", "bogus"],
  ["init", "--ai.x", "claude"],
  ["init", "--backlog", "bogus"],
  ["init", "--backlog", "cloud"],
  ["init", "--scheme", "bogus"],
  ["init", "--spec-backend", "bogus"],
  ["init", "--spec-backend"],
  ["upgrade", "--backlog", "bogus"],
  ["upgrade", "--backlog"],
  ["diff", "a.md", "b.md"],
  ["diff", "a.md"],
  ["reconcile"],
  ["reconcile", "--status"],
  ["reconcile", "--status", "extra"],
  ["reconcile", "--status", "--accept-upstream"],
  ["reconcile", "a.md", "--accept-upstream", "--accept-current"],
  ["reconcile", "--accept-upstream"],
  ["reconcile", "a.md", "b.md", "--accept-current"],
  ["reconcile", "a.md", "--accept-current"],
  ["reconcile", "--status=false"],
  ["reconcile", "--status", "false"],
  ["reconcile", "--status", "true", "x"],
  ["reconcile", "--status=0"],
  ["reconcile", "--no-status"],
  ["--help"],
  ["-h"],
  ["init", "--help"],
  ["--help=false", "bogus"],
  ["--help", "false", "bogus"],
  ["-h", "false"],
  ["-h0"],
  ["-h1"],
  ["--help.x"],
  ["--version"],
  ["-v"],
  ["init", "--version"],
  ["-vh"],
  ["-hv"],
  ["-v", "false"],
  ["--version=false"],
  ["--version=0"],
  ["--version", "false"],
  ["--no-version"],
  ["--no-git=1", "init"],
  ["-ab1"],
  ["-a-"],
  ["-a=b", "init"],
  ["-a.b", "init"],
  ["-ab", "init"],
  ["-vx", "init"],
  ["-xv", "init"],
  ["---x", "init"],
  ["--=x"],
  ["--", "--help"],
  ["init", "--", "--version"],
  ["--", "42"],
  ["login", "--api-url"],
  ["login", "extra"],
  ["self-update", "--check"],
  ["check", "--project"],
  ["bogus", "--x=a\nb"],
  ["-a\nb"],
  ["-h=0\n1", "bogus"],
  ["-v=1\n0", "bogus"],
  ["--a", "1", "--a.b", "2"],
  ["--a.b", "1", "--a.c", "2", "bogus"],
  ["-é", "x"],
  ["init", "--ai", "😀"],
  ["-😀", "x"],
  ["😀"],
];

/** `Name: message`, as an uncaught trace's first line names the error. */
function reasonOf(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function intentOf(args: string[]): unknown {
  try {
    return parseArgs(args);
  } catch (err) {
    return { crash: err instanceof Error ? err.name : String(err) };
  }
}

const destinations = [
  "a/one.md",
  "b/r&d.md",
  "",
  ".",
  "./",
  "a/..",
  "a/../",
  "..",
  "../a",
  "a/../../b",
  "/etc/passwd",
  "//x",
  "a/",
  "a\\",
  "a.",
  "a /b",
  "a/b.",
  "...",
  "a//b.md",
  "./a.md",
  "a/./b.md",
  "a/b/../c.md",
  "a\\..\\b",
  ".hidden",
  "a/.git/config",
  // Windows-shaped and NUL keys: assertSafeDestination runs @std/path's
  // host-dependent normalize. These goldens are generated on a POSIX host,
  // where all three are ordinary relative names.
  "C:\\x",
  "\\\\srv\\x",
  "a\0b",
];

function destinationOf(d: string): string {
  try {
    assertSafeDestination(d);
    return "ok";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const entry = (key: string) =>
  `  ${key}:\n    sha256: x\n    installed_at: '2026-01-01T00:00:00.000Z'\n    templates_version: 0.0.1\n`;
const head = (v: string, harness: string) =>
  `version: ${v}\nharness: ${harness}\ntemplates_version: 0.0.1\n`;

const locks: Record<string, string> = {
  "v2": head("2", "claude") + "entries:\n" + entry("a/one.md") + entry("'b/r&d.md'"),
  "v1-ignores-harness": head("1", "windsurf") + "entries:\n" + entry("a.md"),
  "removed": head("2", "windsurf") + "entries:\n" + entry("a.md"),
  "removed-before-garbage": "version: 2\nharness: windsurf\nentries: 7\n",
  "unknown-harness": head("2", "bogus"),
  "harness-number": head("2", "3"),
  "version-string": head("'2'", "claude"),
  "version-float": head("2.0", "claude"),
  "version-hex": head("0x2", "claude"),
  "version-3": head("3", "claude"),
  "no-version": "harness: claude\ntemplates_version: 0.0.1\n",
  "no-templates-version": "version: 2\nharness: claude\n",
  "templates-version-number": "version: 2\nharness: claude\ntemplates_version: 1.0\n",
  "no-entries": head("2", "claude"),
  "null-entries": head("2", "claude") + "entries: ~\n",
  "entries-scalar": head("2", "claude") + "entries: 7\n",
  "entries-list": head("2", "claude") +
    "entries:\n  - sha256: x\n    installed_at: y\n    templates_version: z\n",
  "entry-escape": head("2", "claude") + "entries:\n" + entry("../x"),
  "entry-absolute": head("2", "claude") + "entries:\n" + entry("/x"),
  "entry-number-field": head("2", "claude") +
    "entries:\n  a.md:\n    sha256: 12\n    installed_at: y\n    templates_version: z\n",
  "entry-timestamp": head("2", "claude") +
    "entries:\n  a.md:\n    sha256: x\n    installed_at: 2026-01-01T00:00:00.000Z\n    templates_version: z\n",
  "entry-int-key": head("2", "claude") + "entries:\n" + entry("0x10"),
  "entry-null-key": head("2", "claude") + "entries:\n" + entry("~"),
  "duplicate-key": head("2", "claude") + "harness: claude\n",
  "anchor-merge": "base: &b\n  sha256: x\n  installed_at: y\n  templates_version: z\n" +
    head("2", "claude") + "entries:\n  a.md:\n    <<: *b\n",
  "root-list": "- 1\n",
  "root-scalar": "hello\n",
  "empty": "",
  "two-documents": head("2", "claude") + "---\n" + head("2", "claude"),
  "malformed": "version: [unterminated\n",
  "bool-yes": head("2", "claude") + "spec_autogen: yes\n",
};

function lockOf(yaml: string): unknown {
  try {
    const lock = parseLock(yaml);
    return { harness: lock.harness, entries: [...lock.entries.keys()].sort() };
  } catch (err) {
    if (err instanceof RemovedHarnessError) return { removed: err.message };
    // The reason, not a boolean: two ports refusing one lock for different
    // reasons would otherwise agree.
    return { error: reasonOf(err) };
  }
}

/**
 * Upgrade's notices for retired config (cli#712): project files in, lines out.
 * The reader is in memory, as the notices see the FsReader port; how the
 * filesystem is walked is the reader's business, not the notices'.
 */
const notices: Record<string, { files: Record<string, string>; tracked?: string[] }> = {
  "empty": { files: {} },
  "extensions-only": { files: { ".specnaut/extensions.yml": "hooks: {}\n" } },
  "addendum": { files: { ".specnaut/addenda/task/review.md": "Dispatch `review-coordinator`.\n" } },
  "every-folder": {
    files: {
      ".claude/agents/a.md": "Ask qa-tester, then test-reviewer, then qa-tester.\n",
      ".codex/agents/b.toml": 'instructions = "hand off to ui-ux-designer"\n',
      ".opencode/agents/c.md": "workflow-manager\n",
      ".agents/agents/d.md": "(devops-sre)\n",
    },
  },
  "not-the-users": {
    files: {
      ".claude/agents/review-coordinator.md": "review-coordinator\n",
      ".claude/agents/qa-tester/memory/MEMORY.md": "qa-tester\n",
      ".claude/agents/notes.txt": "qa-tester\n",
      ".codex/agents/x.md": "qa-tester\n",
      ".claude/skills/mine/SKILL.md": "qa-tester\n",
    },
    tracked: [".claude/agents/review-coordinator.md"],
  },
  "whole-words": {
    files: {
      ".claude/agents/a.md": "my-qa-tester-notes devops-sre2 old-test-reviewer test-reviewer_x\n",
      ".claude/agents/b.md": "éqa-tester\n",
      ".claude/agents/c.md": "qa-tester.\n",
    },
  },
  "both": {
    files: {
      ".specnaut/extensions.yml": "x\n",
      ".specnaut/addenda/ship/tag.md": "devops-sre and review-coordinator\n",
    },
  },
};

function memoryReader(files: Record<string, string>): FsReader {
  return {
    readText: (_d, rel) => Promise.resolve(files[rel] ?? null),
    readEntry: (_d, rel) =>
      Promise.resolve(rel in files ? { kind: "file" as const, content: files[rel] } : null),
    listFiles: (_d, rel) =>
      Promise.resolve(Object.keys(files).filter((p) => p.startsWith(`${rel}/`)).sort()),
  };
}

const here = new URL(".", import.meta.url);

/** One compact JSON value per line. */
async function writeLines(path: string, cases: unknown[]): Promise<void> {
  await Deno.writeTextFile(
    new URL(path, here),
    cases.map((c) => JSON.stringify(c)).join("\n") + "\n",
  );
}

await writeLines(
  "../cli/testdata/parse_golden.jsonl",
  argv.map((args) => ({ args, intent: intentOf(args) })),
);
await writeLines(
  "../lockfile/testdata/destination_golden.jsonl",
  destinations.map((d) => ({ dest: d, result: destinationOf(d) })),
);
await writeLines(
  "../lockfile/testdata/lock_golden.jsonl",
  Object.entries(locks).map(([name, yaml]) => ({ name, yaml, result: lockOf(yaml) })),
);
await writeLines(
  "../upgrade/testdata/agent_folders_golden.jsonl",
  Object.values(AGENT_FOLDERS).filter((f) => f !== null),
);
const noticeCases = [];
for (const [name, c] of Object.entries(notices)) {
  const lines = await retiredConfigNotices(memoryReader(c.files), "/p", new Set(c.tracked ?? []));
  noticeCases.push({ name, files: c.files, tracked: c.tracked ?? [], lines });
}
await writeLines("../upgrade/testdata/notices_golden.jsonl", noticeCases);
