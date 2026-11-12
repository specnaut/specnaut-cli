// The cases, the project, the PATH and the assertion that
// feature_json_read_test.ts and feature_json_readers_test.ts share (cli#763,
// cli#778, cli#780): a repository on `001-demo` holding that feature, and one
// directory of tool wrappers standing in for PATH.

import { assert, assertEquals } from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import { git, type Run, run } from "./git_sandbox.ts";
import { BASH, SCRIPTS } from "./twin_runner.ts";

export const WINDOWS = Deno.build.os === "windows";
export const REFUSAL = (type: string) => `ERROR: Failed to parse .specnaut/feature.json (${type})`;
/** What a fallback resolves to: the branch's own feature directory. */
export const BRANCH = ".specnaut/specs/001-demo";
/**
 * The branch's feature under another parent: a value only a reader that works
 * returns, and one `_feature_json_contradicts_branch` does not refuse.
 */
export const ELSEWHERE = "elsewhere/001-demo";

/** A case expects a refusal line, or the feature directory it resolves to. */
const refused = (expect: string) => expect.startsWith("ERROR: ");
export const outcome = (expect: string) =>
  refused(expect)
    ? "refused, exit 1"
    : expect === BRANCH
    ? "the branch's directory"
    : `the directory it names, ${expect}`;

export type Case = {
  label: string;
  content: string | null;
  unreadable?: boolean;
  unparseable?: boolean;
  /** `.specnaut/feature.json` is a directory, and `content` is null. */
  directory?: boolean;
  expect: string;
};

export const NO_KEY: Case = {
  label: "a feature.json with no feature_directory",
  content: `{"other":1}`,
  expect: BRANCH,
};

/** What each twin, and each bash reader, owes a feature.json. */
export const CASES: Case[] = [
  {
    label: "an unparseable feature.json",
    content: "{not json",
    unparseable: true,
    expect: REFUSAL("ArgumentException"),
  },
  {
    // What it would say if read names the branch's own feature, so a read shows.
    label: "a feature.json that cannot be read (POSIX)",
    content: `{"feature_directory":".specnaut/specs/001-demo"}`,
    unreadable: true,
    expect: REFUSAL("UnauthorizedAccessException"),
  },
  NO_KEY,
  { label: "a feature.json that is not an object", content: "[]", expect: BRANCH },
  { label: "an empty feature.json", content: "", expect: BRANCH },
  { label: "a null feature_directory", content: `{"feature_directory":null}`, expect: BRANCH },
  { label: "no feature.json", content: null, expect: BRANCH },
  {
    // A reader that returns nothing falls back to the branch: this tells them apart.
    label: "a feature.json naming the feature under another parent",
    content: `{"feature_directory":"${ELSEWHERE}"}`,
    expect: ELSEWHERE,
  },
  {
    label: "a feature.json that is a directory",
    content: null,
    directory: true,
    expect: REFUSAL("InvalidOperationException"),
  },
];

/**
 * A repository on `001-demo` holding that feature and ELSEWHERE, the scripts,
 * and the case's feature.json.
 */
export async function withProject(c: Case, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "feature-json-read-" }));
  try {
    await copy(SCRIPTS, join(dir, ".specnaut/scripts"));
    for (const feature of [BRANCH, ELSEWHERE]) {
      await Deno.mkdir(join(dir, feature), { recursive: true });
      await Deno.writeTextFile(join(dir, feature, "plan.md"), "# Plan\n");
    }
    await git(dir, "init", "-q", "-b", "001-demo");
    const featureJson = join(dir, ".specnaut/feature.json");
    if (c.content !== null) await Deno.writeTextFile(featureJson, c.content);
    if (c.directory) await Deno.mkdir(featureJson);
    if (c.unreadable) await Deno.chmod(featureJson, 0o000);
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** The whole of stderr is the one refusal, or nothing and the expected directory. */
export function assertOutcome(c: Case, r: Run, dir: string, featureDir: () => string | undefined) {
  const detail = `stdout: ${r.stdout}\nstderr: ${r.stderr}`;
  if (!refused(c.expect)) {
    assertEquals(r.code, 0, detail);
    assertEquals(r.stderr, "", detail);
    assertEquals(
      featureDir()?.replaceAll("\\", "/"),
      `${dir}/${c.expect}`.replaceAll("\\", "/"),
    );
  } else {
    assertEquals(r.code, 1, detail);
    assertEquals(r.stderr.split(/\r?\n/).filter(Boolean), [c.expect], detail);
    assertEquals(r.stdout, "", detail);
    assert(!r.stderr.includes(dir), `a path reached stderr: ${r.stderr}`);
  }
}

/** The tool's absolute path, as bash finds it, or null. */
export async function which(tool: string): Promise<string | null> {
  const r = await run(BASH, ["-c", `command -v ${tool}`], ".");
  return r.code === 0 ? r.stdout.trim() : null;
}

const BASE_TOOLS = ["git", "dirname", "basename", "grep", "sed"];

/**
 * One directory standing in for PATH: a wrapper per tool, over the real one
 * by absolute path — what `get_feature_paths` calls, and the reader's own —
 * and a stub per `stubs` entry, its body a sh script's. Off Windows only: a
 * wrapper needs a mode bit.
 */
export async function toolBin(
  dir: string,
  tools: string[],
  stubs: Record<string, string> = {},
): Promise<string> {
  const bin = join(dir, "reader-bin");
  await Deno.mkdir(bin);
  const scripts = { ...stubs };
  for (const tool of [...BASE_TOOLS, ...tools]) scripts[tool] = `exec '${await which(tool)}' "$@"`;
  for (const [tool, body] of Object.entries(scripts)) {
    await Deno.writeTextFile(join(bin, tool), `#!/bin/sh\n${body}\n`);
    await Deno.chmod(join(bin, tool), 0o755);
  }
  return bin;
}
