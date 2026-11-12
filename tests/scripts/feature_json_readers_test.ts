// cli#780, cli#782 — the bash twin reads `.specnaut/feature.json` with jq, else
// python3, else a single-line grep, by what PATH holds, and each reader owes
// feature_json_read_test.ts's table. The grep reader cannot tell an
// unparseable file from one without the key, so it falls back to the branch on
// both; its row pins that. A reader that fails to start is not the file's
// fault: the next reader answers.

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  assertOutcome,
  BRANCH,
  type Case,
  CASES,
  ELSEWHERE,
  NO_KEY,
  outcome,
  REFUSAL,
  toolBin,
  which,
  WINDOWS,
  withProject,
} from "./feature_json_fixture.ts";
import { run } from "./git_sandbox.ts";
import { BASH, results, type Shell, twins, UNREADABLE_OK } from "./twin_runner.ts";

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

/** `get_feature_paths` in bash, under the shell `shell` builds in the project. */
function resolveIn(c: Case, shell: (dir: string) => Promise<Shell>) {
  return () =>
    withProject(c, async (dir) => {
      const scripts = join(dir, ".specnaut/scripts");
      const r = await bash.functions(scripts, { bash: RESOLVE, pwsh: "" }, dir, await shell(dir));
      assertOutcome(c, r, dir, () => results(r)[0]);
    });
}

/** `get_feature_paths` in bash, with PATH holding `tools` and `stubs` (`toolBin`). */
const resolveRow = (c: Case, tools: string[], stubs: Record<string, string> = {}) =>
  resolveIn(c, async (dir) => ({ path: await toolBin(dir, tools, stubs) }));

for (const { reader, tools, unparseable } of READERS) {
  const missing = (await Promise.all(tools.map(which))).includes(null);
  if (missing) console.warn(`  note: ${reader} is absent — its bash reader rows did not run`);
  for (const c of CASES) {
    const expected = { ...c, expect: c.unparseable ? unparseable : c.expect };
    Deno.test({
      name: `feature.json [bash, ${reader} reader]: ${c.label} — ${outcome(expected.expect)}`,
      ignore: WINDOWS || missing || (c.unreadable && !UNREADABLE_OK),
      fn: resolveRow(expected, tools),
    });
  }
}

// A python3 that runs and cannot parse the file is refused; one that fails to
// start (the Windows Store alias: a message, status 9009, 49 to bash) is not the
// file's fault, and the grep reader answers. Each file is one grep would read.
const PYTHON3_MISSING = await which("python3") === null;
const ONE_LINE: Case = {
  label: "",
  content: `{"feature_directory":"${ELSEWHERE}"}`,
  expect: ELSEWHERE,
};
Deno.test({
  name:
    "feature.json [bash, python3 reader]: a python3 that fails to start — the grep reader's answer",
  ignore: WINDOWS,
  fn: resolveRow(ONE_LINE, [], { python3: "echo 'Python was not found' >&2\nexit 49" }),
});
Deno.test({
  name: "feature.json [bash, python3 reader]: a python3 that fails to parse — refused, exit 1",
  ignore: WINDOWS || PYTHON3_MISSING,
  fn: resolveRow(
    {
      label: "",
      content: `{"feature_directory":"${ELSEWHERE}",`,
      expect: REFUSAL("ArgumentException"),
    },
    ["python3"],
  ),
});

// A jq that fails to start is not the file's fault either: the python3 reader
// answers, for a file whose value grep misses (on a line of its own).
Deno.test({
  name: "feature.json [bash, jq reader]: a jq that fails to start — the python3 reader's answer",
  ignore: WINDOWS || PYTHON3_MISSING,
  fn: resolveRow(
    { label: "", content: `{"feature_directory":\n"${ELSEWHERE}"}`, expect: ELSEWHERE },
    ["python3"],
    { jq: "echo 'jq: cannot execute binary file' >&2\nexit 126" },
  ),
});

/**
 * On Windows, PATH as bash spells it: the directories of Git's own tools, and
 * every WindowsApps entry — where the Store alias for python3 lives when the
 * runner has one. No wrapper (they need a mode bit), so no other python3 and
 * no jq; WINDOWS_PYTHON3 checks both.
 */
const WINDOWS_PATH = [
  "_p=",
  'for _t in git grep sed dirname basename; do _c=$(command -v "$_t") && _p="$_p:${_c%/*}"; done',
  '_ifs=$IFS; IFS=:; for _d in $PATH; do case "$_d" in */[Ww]indows[Aa]pps) _p="$_p:$_d" ;; esac; done',
  "IFS=$_ifs; PATH=${_p#:}\n",
].join("\n");

/** What the python3 on WINDOWS_PATH is, as the row's label; or why the row cannot run. */
async function windowsPython3(): Promise<{ label: string; skip?: string }> {
  const r = await run(BASH, [
    "-c",
    `${WINDOWS_PATH}if command -v jq >/dev/null; then echo jq; elif ! command -v python3 >/dev/null; then echo none; elif python3 -c '' >/dev/null 2>&1; then echo starts; else echo fails; fi`,
  ], ".");
  const found = r.stdout.trim();
  if (found === "fails") return { label: "python3 is the Store alias, which fails to start" };
  if (found === "none") {
    return { label: "no python3 on PATH (no Store alias on this runner: the stub row stands in)" };
  }
  const why = found === "jq"
    ? "a jq sits among Git's tools and would answer first"
    : found === "starts"
    ? "the WindowsApps python3 starts, so no launcher fails here"
    : `the probe failed (${r.code}): ${r.stderr.trim()}`;
  return { label: "the runner's own python3", skip: why };
}

// The python3 that fails to start, on a real Windows launcher rather than a
// stub: the grep reader answers, and the file is never refused for it.
const STORE = WINDOWS ? await windowsPython3() : null;
if (STORE?.skip) console.warn(`  note: ${STORE.skip} — the Windows python3 row did not run`);
Deno.test({
  name: `feature.json [bash, Windows]: ${STORE?.label ?? "a real python3 launcher"} — ${
    outcome(ELSEWHERE)
  }`,
  ignore: !WINDOWS || STORE?.skip !== undefined,
  fn: resolveIn(ONE_LINE, () => Promise.resolve({ before: { bash: WINDOWS_PATH } })),
});

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
