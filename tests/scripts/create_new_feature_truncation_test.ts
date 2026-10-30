// GitHub refuses a branch name over 244 bytes, so `create-new-feature` cuts the
// slug to fit and then drops the hyphen the cut can leave at its end. Both
// twins carry the rule; this pins that they produce the same name, and that
// the dangling hyphen is gone, when the cut lands right after one.

import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const SCRIPTS = fromFileUrl(new URL("../../templates/core/specnaut/scripts/", import.meta.url));

async function exec(cmd: string, args: string[], cwd: string) {
  const { code, stdout, stderr } = await new Deno.Command(cmd, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function hasPwsh(): Promise<boolean> {
  try {
    return (await exec("pwsh", ["-NoProfile", "-Command", "exit 0"], ".")).code === 0;
  } catch {
    return false;
  }
}

const PWSH_AVAILABLE = await hasPwsh();

// "001-" leaves 240 bytes for the slug; the cut keeps 239 letters and the
// hyphen after them, which must not survive into the branch name.
const SHORT_NAME = `${"a".repeat(239)}-${"b".repeat(10)}`;
const EXPECTED = `001-${"a".repeat(239)}`;

const RUNNERS = [
  {
    name: "bash",
    ignore: false,
    args: [
      join(SCRIPTS, "bash", "create-new-feature.sh"),
      "--json",
      "--dry-run",
      "--short-name",
      SHORT_NAME,
      "a long feature",
    ],
    cmd: "bash",
  },
  {
    name: "pwsh",
    // Never skipped on CI: GitHub-hosted runners ship pwsh, so its absence there
    // must fail rather than pass the twin unexercised.
    ignore: !PWSH_AVAILABLE && Deno.env.get("CI") !== "true",
    args: [
      "-NoProfile",
      "-File",
      join(SCRIPTS, "powershell", "create-new-feature.ps1"),
      "-Json",
      "-DryRun",
      "-ShortName",
      SHORT_NAME,
      "a long feature",
    ],
    cmd: "pwsh",
  },
];

for (const runner of RUNNERS) {
  Deno.test({
    name: `create-new-feature [${runner.name}]: a slug cut to 244 bytes does not end on a hyphen`,
    ignore: runner.ignore,
    fn: async () => {
      const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "cnf-truncate-" }));
      try {
        await exec("git", ["init", "-q"], dir);
        const r = await exec(runner.cmd, runner.args, dir);
        assertEquals(r.code, 0, r.stderr);
        // The JSON object is the last stdout line; pwsh may print host noise first.
        const json = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "");
        assertEquals(json.BRANCH_NAME, EXPECTED);
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    },
  });
}
