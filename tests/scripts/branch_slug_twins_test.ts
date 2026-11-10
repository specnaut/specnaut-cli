// cli#719 — `branch-naming.sh` and `branch-naming.ps1` give a new branch the same
// slug. Both carry the rule "keep a short word only when it appears in uppercase
// in the description", and each missed it a different way: `${word^^}` is a bad
// substitution on the bash 3.2 macOS ships, so the acronym branch never ran there;
// PowerShell's `-match` ignores case, so the guard never refused anything.
//
// One scenario list over both twins, so an expected value cannot differ per twin.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { git, type Run, run } from "./git_sandbox.ts";
import { bashArgv } from "../helpers/bash_argv.ts";
import { guardPowerShellArm, PWSH_AVAILABLE } from "./pwsh_arm.ts";

const SCRIPTS = fromFileUrl(new URL("../../templates/core/specnaut/scripts/", import.meta.url));

const DARWIN = Deno.build.os === "darwin";

/** macOS's stock bash: the one the twins' defects live on, whatever `bash` PATH finds first. */
const BASH = DARWIN ? "/bin/bash" : "bash";

guardPowerShellArm();

Deno.test({
  name: "on macOS the bash twin is held to bash 3.2",
  ignore: !DARWIN,
  fn: async () => {
    // Were /bin/bash ever a newer one, `${word^^}` would pass here and the
    // scenarios below would prove nothing about the bash users have.
    const r = await run(BASH, ["-c", 'printf %s "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"'], ".");
    assertEquals(r.stdout, "3.2");
  },
});

/** What the scenarios vary, independent of either script's flag spelling. */
type Input = { description: string; shortName?: string };

const TWINS = [
  {
    name: "bash",
    quietStderr: true,
    run: ({ description, shortName }: Input, cwd: string) => {
      // Through bashArgv: on Windows a newline in a direct argument splits it in two.
      const bash = bashArgv([
        join(SCRIPTS, "bash/create-new-feature.sh"),
        "--json",
        "--dry-run",
        ...(shortName === undefined ? [] : ["--short-name", shortName]),
        description,
      ]);
      return run(BASH, bash.args, cwd, bash.env);
    },
  },
  ...(PWSH_AVAILABLE
    ? [{
      name: "pwsh",
      // Its stderr is not held to the same: nothing in the twin's defect reaches it.
      quietStderr: false,
      run: ({ description, shortName }: Input, cwd: string) =>
        run("pwsh", [
          "-NoProfile",
          "-File",
          join(SCRIPTS, "powershell/create-new-feature.ps1"),
          "-Json",
          "-DryRun",
          ...(shortName === undefined ? [] : ["-ShortName", shortName]),
          description,
        ], cwd),
    }]
    : []),
];

const SCENARIOS: Array<{ label: string; input: Input; slug: string }> = [
  {
    label: "an uppercase acronym is kept",
    input: { description: "Fix UI in cli" },
    slug: "fix-ui-cli",
  },
  {
    label: "a lowercase short word is dropped",
    input: { description: "fix ui in cli" },
    slug: "fix-cli",
  },
  {
    label: "repeated hyphens collapse",
    input: { description: "anything", shortName: "foo -- bar baz" },
    slug: "foo-bar-baz",
  },
  {
    label: "a newline in the short name becomes a hyphen",
    input: { description: "anything", shortName: "foo\nbar" },
    slug: "foo-bar",
  },
];

async function withRepo(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "branch-slug-" });
  try {
    await git(dir, "init", "-q", "-b", "main");
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** The JSON object is the last stdout line; pwsh may print host noise first. */
const lastJson = (r: Run) => JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "");

for (const twin of TWINS) {
  for (const { label, input, slug } of SCENARIOS) {
    Deno.test(`branch slug [${twin.name}]: ${label}`, async () => {
      await withRepo(async (dir) => {
        const r = await twin.run(input, dir);
        assertEquals(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
        assertEquals(lastJson(r).BRANCH_NAME, `001-${slug}`);
        if (twin.quietStderr) assertEquals(r.stderr, "");
      });
    });
  }
}

Deno.test({
  name: "create-new-feature.ps1 no longer outputs HAS_GIT, in JSON or in text",
  ignore: !PWSH_AVAILABLE,
  fn: () =>
    withRepo(async (dir) => {
      const script = join(SCRIPTS, "powershell/create-new-feature.ps1");
      const base = ["-NoProfile", "-File", script, "-DryRun"];
      const json = await run("pwsh", [...base, "-Json", "Export invoices"], dir);
      assertEquals(json.code, 0, json.stderr);
      // The branch name first: absence from an output that never got printed proves nothing.
      assertEquals(lastJson(json).BRANCH_NAME, "001-export-invoices");
      assert(!("HAS_GIT" in lastJson(json)), json.stdout);

      const text = await run("pwsh", [...base, "Export invoices"], dir);
      assertEquals(text.code, 0, text.stderr);
      assertStringIncludes(text.stdout, "BRANCH_NAME: 001-export-invoices");
      assert(!text.stdout.includes("HAS_GIT"), text.stdout);
    }),
});
