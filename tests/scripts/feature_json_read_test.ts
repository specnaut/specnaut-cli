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
import { join } from "@std/path";
import {
  assertOutcome,
  BRANCH,
  type Case,
  REFUSAL,
  toolBin,
  which,
  WINDOWS,
  withProject,
} from "./feature_json_fixture.ts";
import { guardPowerShellArm } from "./pwsh_arm.ts";
import { results, twins, UNREADABLE_OK } from "./twin_runner.ts";

guardPowerShellArm();

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

/** Each bash reader, chosen by what PATH holds (`toolBin`). */
const READERS = [
  { reader: "jq", tools: ["jq"], unparseable: REFUSAL("ArgumentException") },
  { reader: "python3", tools: ["python3"], unparseable: REFUSAL("ArgumentException") },
  { reader: "grep", tools: [], unparseable: BRANCH },
];

Deno.test("the bash readers' jq and python3 are present where they must be", async () => {
  if (Deno.env.get("CI") === "true" && !WINDOWS) {
    for (const tool of ["jq", "python3"]) assert(await which(tool), `${tool} is absent on CI`);
  }
});

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
