// cli#763 — `Get-FeatureJsonDirectory` reads `.specnaut/feature.json` inside its
// try, so a file it cannot read is refused in the fixed text an unparseable one
// gets, with the same exit, and Get-Content's own error (which names the file)
// never reaches stderr.
//
// PowerShell only. The bash twin refuses neither: `_feature_json_dir` hides its
// reader's failure and `get_feature_paths` falls back to the branch, exit 0, on
// an unparseable file and on an unreadable one alike. That divergence predates
// cli#763 and is not this row's to settle; it is reported with it.

import { assert, assertEquals, assertMatch } from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import { git, run } from "./git_sandbox.ts";
import { guardPowerShellArm, PWSH_AVAILABLE } from "./pwsh_arm.ts";
import { SCRIPTS, twins } from "./twin_runner.ts";

guardPowerShellArm();

/**
 * A file this process cannot open is a mode, and only a non-root POSIX user is
 * refused by one: Windows keeps no mode bits, and root reads any file.
 */
const UNREADABLE_OK = Deno.build.os !== "windows" &&
  (await run("id", ["-u"], ".").catch(() => undefined))?.stdout.trim() !== "0";

const REFUSAL = /^ERROR: Failed to parse \.specnaut\/feature\.json \(\w+\)$/;

const ROWS = [
  { label: "an unparseable feature.json", content: "{not json", unreadable: false },
  {
    // What it would say if read names the branch's own feature, so a read shows.
    label: "a feature.json that cannot be read (POSIX)",
    content: `{"feature_directory":".specnaut/specs/001-demo"}`,
    unreadable: true,
  },
];

for (const row of ROWS) {
  Deno.test({
    name: `feature.json [pwsh]: ${row.label} is refused in fixed text, exit 1`,
    ignore: !PWSH_AVAILABLE || (row.unreadable && !UNREADABLE_OK),
    fn: async () => {
      const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "feature-json-read-" }));
      try {
        await copy(SCRIPTS, join(dir, ".specnaut/scripts"));
        await Deno.mkdir(join(dir, ".specnaut/specs/001-demo"), { recursive: true });
        await Deno.writeTextFile(join(dir, ".specnaut/specs/001-demo/plan.md"), "# Plan\n");
        await git(dir, "init", "-q", "-b", "001-demo");
        const featureJson = join(dir, ".specnaut/feature.json");
        await Deno.writeTextFile(featureJson, row.content);
        if (row.unreadable) await Deno.chmod(featureJson, 0o000);
        const [pwsh] = twins(false);
        const r = await pwsh.entry(join(dir, ".specnaut/scripts"), "check-prerequisites", [
          "--json",
        ], dir);
        assertEquals(r.code, 1, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
        const lines = r.stderr.split(/\r?\n/).filter(Boolean);
        assertEquals(lines.length, 1, r.stderr);
        assertMatch(lines[0], REFUSAL);
        assert(!r.stderr.includes(dir), `a path reached stderr: ${r.stderr}`);
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    },
  });
}
