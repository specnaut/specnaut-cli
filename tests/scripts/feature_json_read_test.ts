// cli#763, cli#778 — a `.specnaut/feature.json` that exists but cannot be read
// or parsed is refused by both twins in one fixed line, exit 1: the PowerShell
// twin's `Get-FeatureJsonDirectory` line, with the .NET type its reader names
// for that failure, which bash prints too. No path and no reader's own text
// (Get-Content's, jq's, python3's) reaches stderr. A file that parses but names
// no feature directory, and an absent one, still fall back to the branch.
//
// The bash twin has three readers, by what PATH holds: jq, else python3, else a
// single-line grep. The grep reader cannot tell an unparseable file from one
// without the key, so it falls back to the branch on both; its row pins that.

import { assert, assertEquals } from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import { git, type Run, run } from "./git_sandbox.ts";
import { guardPowerShellArm } from "./pwsh_arm.ts";
import { BASH, results, SCRIPTS, twins, UNREADABLE_OK } from "./twin_runner.ts";

guardPowerShellArm();

const WINDOWS = Deno.build.os === "windows";
const REFUSAL = (type: string) => `ERROR: Failed to parse .specnaut/feature.json (${type})`;
/** What a fallback resolves to: the branch's own feature directory. */
const BRANCH = "branch";

type Case = {
  label: string;
  content: string | null;
  unreadable?: boolean;
  unparseable?: boolean;
  expect: string;
};

const NO_KEY: Case = {
  label: "a feature.json with no feature_directory",
  content: `{"other":1}`,
  expect: BRANCH,
};

const CASES: Case[] = [
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
];

/** A repository on `001-demo` holding that feature, the scripts, and the case's feature.json. */
async function withProject(c: Case, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "feature-json-read-" }));
  try {
    await copy(SCRIPTS, join(dir, ".specnaut/scripts"));
    await Deno.mkdir(join(dir, ".specnaut/specs/001-demo"), { recursive: true });
    await Deno.writeTextFile(join(dir, ".specnaut/specs/001-demo/plan.md"), "# Plan\n");
    await git(dir, "init", "-q", "-b", "001-demo");
    const featureJson = join(dir, ".specnaut/feature.json");
    if (c.content !== null) await Deno.writeTextFile(featureJson, c.content);
    if (c.unreadable) await Deno.chmod(featureJson, 0o000);
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** The whole of stderr is the one refusal, or nothing and the branch's directory. */
function assertOutcome(c: Case, r: Run, dir: string, featureDir: () => string | undefined) {
  const detail = `stdout: ${r.stdout}\nstderr: ${r.stderr}`;
  if (c.expect === BRANCH) {
    assertEquals(r.code, 0, detail);
    assertEquals(r.stderr, "", detail);
    assertEquals(
      featureDir()?.replaceAll("\\", "/"),
      `${dir}/.specnaut/specs/001-demo`.replaceAll("\\", "/"),
    );
  } else {
    assertEquals(r.code, 1, detail);
    assertEquals(r.stderr.split(/\r?\n/).filter(Boolean), [c.expect], detail);
    assertEquals(r.stdout, "", detail);
    assert(!r.stderr.includes(dir), `a path reached stderr: ${r.stderr}`);
  }
}

for (const twin of twins()) {
  for (const c of CASES) {
    Deno.test({
      name: `feature.json [${twin.name}]: ${c.label} — ${
        c.expect === BRANCH ? "the branch's directory" : "refused, exit 1"
      }`,
      ignore: c.unreadable && !UNREADABLE_OK,
      fn: () =>
        withProject(c, async (dir) => {
          const r = await twin.entry(join(dir, ".specnaut/scripts"), "check-prerequisites", [
            "--json",
          ], dir);
          assertOutcome(c, r, dir, () => JSON.parse(r.stdout).FEATURE_DIR);
        }),
    });
  }
}

/** The tool's absolute path, as bash finds it, or null. */
async function which(tool: string): Promise<string | null> {
  const r = await run(BASH, ["-c", `command -v ${tool}`], ".");
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * Each bash reader, chosen by what PATH holds. PATH is one directory of
 * wrappers over the real tools by absolute path: what `get_feature_paths`
 * calls, and the reader's own. Off Windows only: a wrapper needs a mode bit.
 */
const READERS = [
  { reader: "jq", tools: ["jq"], unparseable: REFUSAL("ArgumentException") },
  { reader: "python3", tools: ["python3"], unparseable: REFUSAL("ArgumentException") },
  { reader: "grep", tools: [], unparseable: BRANCH },
];
const BASE_TOOLS = ["git", "dirname", "basename", "grep", "sed"];

Deno.test("the bash readers' jq and python3 are present where they must be", async () => {
  if (Deno.env.get("CI") === "true" && !WINDOWS) {
    for (const tool of ["jq", "python3"]) assert(await which(tool), `${tool} is absent on CI`);
  }
});

/** One directory standing in for PATH: a wrapper per tool, over the real one. */
async function toolBin(dir: string, tools: string[]): Promise<string> {
  const bin = join(dir, "reader-bin");
  await Deno.mkdir(bin);
  for (const tool of [...BASE_TOOLS, ...tools]) {
    await Deno.writeTextFile(join(bin, tool), `#!/bin/sh\nexec '${await which(tool)}' "$@"\n`);
    await Deno.chmod(join(bin, tool), 0o755);
  }
  return bin;
}

const [bash] = twins();
const RESOLVE =
  `out=$(get_feature_paths) || exit $?\neval "$out"\nprintf 'RESULT %s\\n' "$FEATURE_DIR"`;
for (const { reader, tools, unparseable } of READERS) {
  const missing = (await Promise.all(tools.map(which))).includes(null);
  if (missing) console.warn(`  note: ${reader} is absent — its bash reader rows did not run`);
  for (const c of CASES) {
    const expected = { ...c, expect: c.unparseable ? unparseable : c.expect };
    Deno.test({
      name: `feature.json [bash, ${reader} reader]: ${c.label} — ${
        expected.expect === BRANCH ? "the branch's directory" : "refused, exit 1"
      }`,
      ignore: WINDOWS || missing || (c.unreadable && !UNREADABLE_OK),
      fn: () =>
        withProject(c, async (dir) => {
          const path = await toolBin(dir, tools);
          const r = await bash.functions(
            join(dir, ".specnaut/scripts"),
            { bash: RESOLVE, pwsh: "" },
            dir,
            {
              path,
            },
          );
          assertOutcome(expected, r, dir, () => results(r)[0]);
        }),
    });
  }
}

// The grep reader's "no key" is grep matching nothing: under pipefail its status
// is grep's 1, and a caller under `set -e` would stop where it should carry on.
Deno.test({
  name:
    "feature.json [bash, grep reader]: no key under set -euo pipefail is status 0, and the caller carries on",
  ignore: WINDOWS,
  fn: () =>
    withProject(NO_KEY, async (dir) => {
      const r = await bash.functions(
        join(dir, ".specnaut/scripts"),
        {
          bash: `_feature_json_dir .specnaut/feature.json\nprintf 'RESULT carried on\\n'`,
          pwsh: "",
        },
        dir,
        { path: await toolBin(dir, []), before: { bash: "set -euo pipefail\n" } },
      );
      assertEquals([r.code, r.stderr, results(r)], [0, "", ["carried on"]]);
    }),
});
