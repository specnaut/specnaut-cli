// cli#763, cli#778, cli#780 — a `.specnaut/feature.json` that exists but cannot be read
// or parsed is refused by both twins in one fixed line, exit 1: the PowerShell
// twin's `Get-FeatureJsonDirectory` line, with the .NET type its reader names
// for that failure, which bash prints too. No path and no reader's own text
// (Get-Content's, jq's, python3's) reaches stderr. A file that parses but names
// no feature directory, and an absent one, still fall back to the branch. One
// that is a directory is refused as PowerShell refuses it, never skipped.
//
// The bash twin's three readers, each by what PATH holds, are
// feature_json_readers_test.ts's.

import { join } from "@std/path";
import { assertOutcome, CASES, outcome, withProject } from "./feature_json_fixture.ts";
import { guardPowerShellArm } from "./pwsh_arm.ts";
import { twins, UNREADABLE_OK } from "./twin_runner.ts";

guardPowerShellArm();

for (const twin of twins()) {
  for (const c of CASES) {
    Deno.test({
      name: `feature.json [${twin.name}]: ${c.label} — ${outcome(c.expect)}`,
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
