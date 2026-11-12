// Regression tests for `add.sh` flag handling across the backlog backends.
//
// Before #333 the argument loop only special-cased `--parent`; the `*)`
// catch-all swallowed `--help` and any unknown `--flag` as a positional
// argument, so `add.sh --help` created a real issue titled `--help`
// instead of printing usage. These tests pin the corrected contract:
//
//   - `--help` / `-h` print usage to stdout and exit 0, creating nothing.
//   - an unrecognised `--flag` is rejected (exit 2, error on stderr).
//
// Every backend's script sources `_config.sh` (which exits 2 on a
// missing backlog-config.yml), so the scripts are run from an empty temp
// dir on purpose: flag handling must work *before* — and independently
// of — the backend config check.

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { BACKENDS, SCRIPTS } from "./backlog_tracker_fixture.ts";

/**
 * `add.sh` installed as `init` lays it out — flat, beside the argument parser
 * it sources (`_backlog_args.sh`) — in a project with no backlog-config.yml.
 */
async function run(
  backend: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cwd = await Deno.makeTempDir({ prefix: "backlog-add-flag-" });
  try {
    const scripts = join(cwd, ".specnaut", "scripts", "backlog");
    await Deno.mkdir(scripts, { recursive: true });
    await Deno.copyFile(join(SCRIPTS, backend, "add.sh"), join(scripts, "add.sh"));
    await Deno.copyFile(join(SCRIPTS, "_backlog_args.sh"), join(scripts, "_backlog_args.sh"));
    const { code, stdout, stderr } = await new Deno.Command("bash", {
      args: [join(scripts, "add.sh"), ...args],
      cwd,
      stdout: "piped",
      stderr: "piped",
    }).output();
    return {
      code,
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
    };
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
}

for (const name of BACKENDS) {
  Deno.test(`add.sh (${name}): --help prints usage and exits 0`, async () => {
    const { code, stdout } = await run(name, ["--help"]);
    assertEquals(code, 0, `--help must exit 0, got ${code}`);
    assert(
      stdout.includes("usage:"),
      `--help must print usage to stdout, got: ${JSON.stringify(stdout)}`,
    );
  });

  Deno.test(`add.sh (${name}): -h prints usage and exits 0`, async () => {
    const { code, stdout } = await run(name, ["-h"]);
    assertEquals(code, 0, `-h must exit 0, got ${code}`);
    assert(stdout.includes("usage:"), `-h must print usage, got: ${JSON.stringify(stdout)}`);
  });

  Deno.test(`add.sh (${name}): unknown --flag is rejected with exit 2`, async () => {
    const { code, stderr } = await run(name, ["--bogus"]);
    assertEquals(code, 2, `unknown flag must exit 2, got ${code}`);
    assert(
      stderr.includes("unknown flag"),
      `unknown flag must explain itself on stderr, got: ${JSON.stringify(stderr)}`,
    );
  });
}
