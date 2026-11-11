// cli#764 — `--number` and `--issue` take what a signed 64-bit integer holds, in
// both twins. PowerShell binds `-Number` and `-Issue` to `[long]` and refuses
// anything past it; bash checked only for digits, then its arithmetic wrapped
// (`99999999999999999999` named the branch `7766279631452241919-demo`) and its
// `[ -lt ]` failed open, linking an issue no tracker can hold.
//
// Each row runs for real in a repository, so a refusal is shown by the branch
// and the spec directory that were not created, not by an exit code alone.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import { git } from "./git_sandbox.ts";
import { guardPowerShellArm } from "./pwsh_arm.ts";
import { SCRIPTS, twins } from "./twin_runner.ts";

guardPowerShellArm();

const MAX = "9223372036854775807";

/**
 * A flag's value and the branch both twins owe for it, `null` when both refuse
 * it; and, for `--issue`, the LINKED_ISSUE text their JSON carries: the value,
 * never the digits as typed (`042` is no JSON number).
 */
const ROWS: Array<
  { flag: "--number" | "--issue"; value: string; branch: string | null; linked?: string }
> = [
  { flag: "--number", value: "99999999999999999999", branch: null },
  { flag: "--number", value: "9223372036854775808", branch: null },
  { flag: "--number", value: MAX, branch: `${MAX}-demo` },
  { flag: "--number", value: `000${MAX}`, branch: `${MAX}-demo` },
  { flag: "--issue", value: "99999999999999999999", branch: null },
  { flag: "--issue", value: "9223372036854775808", branch: null },
  { flag: "--issue", value: MAX, branch: "001-demo", linked: MAX },
  { flag: "--issue", value: "042", branch: "001-demo", linked: "42" },
  { flag: "--issue", value: `000${MAX}`, branch: "001-demo", linked: MAX },
];

async function withRepo(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "cnf-bounds-twins-" }));
  try {
    await git(dir, "init", "-q", "-b", "main");
    await git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "x");
    await copy(SCRIPTS, join(dir, ".specnaut/scripts"));
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const branches = async (dir: string) =>
  (await git(dir, "for-each-ref", "--format=%(refname:short)", "refs/heads")).split(/\r?\n/)
    .filter(Boolean).sort();

async function specDirs(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const e of Deno.readDir(join(dir, ".specnaut/specs"))) names.push(e.name);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  return names.sort();
}

for (const twin of twins()) {
  for (const { flag, value, branch, linked } of ROWS) {
    const verdict = branch === null ? "refused, no branch created" : `accepted as ${branch}`;
    Deno.test(`create-new-feature bounds [${twin.name}]: ${flag} ${value} is ${verdict}`, () =>
      withRepo(async (dir) => {
        const args = ["--json", flag, value, "--short-name", "demo", "Demo"];
        const r = await twin.entry(join(dir, ".specnaut/scripts"), "create-new-feature", args, dir);
        const why = `stdout: ${r.stdout}\nstderr: ${r.stderr}`;
        if (branch === null) {
          assertEquals(r.code, 1, why);
          assertEquals(await branches(dir), ["main"], why);
          assertEquals(await specDirs(dir), [], why);
        } else {
          assertEquals(r.code, 0, why);
          assertEquals(await branches(dir), [branch, "main"].sort(), why);
          assertEquals(await specDirs(dir), [branch], why);
          if (linked) {
            // The text, not JSON.parse: a 19-digit value does not survive a double.
            assertEquals(r.stdout.match(/"LINKED_ISSUE":\s*([^,}\s]+)/)?.[1], linked, why);
            // What parent-of.sh and move.sh are handed, which jq's JSON does not show.
            assertStringIncludes(r.stderr, `treating issue ${linked} as standalone`);
          }
        }
      }));
  }
}
