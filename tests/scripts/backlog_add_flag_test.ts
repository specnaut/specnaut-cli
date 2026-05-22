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
// The github/gitlab scripts source `_config.sh` (which exits 2 on a
// missing backlog-config.yml), so the scripts are run from an empty temp
// dir on purpose: flag handling must work *before* — and independently
// of — the backend config check.

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const BACKENDS = [
  { name: "github", rel: "../../templates/core/skills/backlog/scripts/github/add.sh" },
  { name: "gitlab", rel: "../../templates/core/skills/backlog/scripts/gitlab/add.sh" },
  { name: "local", rel: "../../templates/core/skills/backlog/scripts/local/add.sh" },
];

function scriptPath(rel: string): string {
  return fromFileUrl(new URL(rel, import.meta.url));
}

async function run(
  script: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cwd = await Deno.makeTempDir({ prefix: "backlog-add-flag-" });
  try {
    const { code, stdout, stderr } = await new Deno.Command("bash", {
      args: [script, ...args],
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

for (const backend of BACKENDS) {
  const script = scriptPath(backend.rel);

  Deno.test(`add.sh (${backend.name}): --help prints usage and exits 0`, async () => {
    const { code, stdout } = await run(script, ["--help"]);
    assertEquals(code, 0, `--help must exit 0, got ${code}`);
    assert(
      stdout.includes("usage:"),
      `--help must print usage to stdout, got: ${JSON.stringify(stdout)}`,
    );
  });

  Deno.test(`add.sh (${backend.name}): -h prints usage and exits 0`, async () => {
    const { code, stdout } = await run(script, ["-h"]);
    assertEquals(code, 0, `-h must exit 0, got ${code}`);
    assert(stdout.includes("usage:"), `-h must print usage, got: ${JSON.stringify(stdout)}`);
  });

  Deno.test(`add.sh (${backend.name}): unknown --flag is rejected with exit 2`, async () => {
    const { code, stderr } = await run(script, ["--bogus"]);
    assertEquals(code, 2, `unknown flag must exit 2, got ${code}`);
    assert(
      stderr.includes("unknown flag"),
      `unknown flag must explain itself on stderr, got: ${JSON.stringify(stderr)}`,
    );
  });
}
