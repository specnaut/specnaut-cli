// cli#752 — `create-new-feature` relays nothing a backlog helper wrote. The
// helpers quote what a tracker returned, and a tracker holds text anyone can
// write: `parent-of.sh`'s stdout and stderr became the epic number and a status
// line, and `move.sh`'s whole output was echoed after the card moved. A parent
// is now a number or no answer, and a move that succeeded says so in fixed text.
//
// A marker on every stream a stub helper writes stands for that text; it must
// reach neither of the script's streams, and the outcome must still be named.

import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs";
import { fromFileUrl, join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { git, type Run, run } from "./git_sandbox.ts";
import { guardPowerShellArm, PWSH_AVAILABLE } from "./pwsh_arm.ts";

const SCRIPTS = fromFileUrl(new URL("../../templates/core/specnaut/scripts/", import.meta.url));
const BASH = Deno.build.os === "darwin" ? "/bin/bash" : "bash";
const MARKER = "MARKERQV7";

guardPowerShellArm();

const TWINS = [
  {
    name: "bash",
    create: (dir: string, number: string, issue: boolean) =>
      run(BASH, [
        bashPath(join(dir, ".specnaut/scripts/bash/create-new-feature.sh")),
        "--json",
        "--number",
        number,
        "--short-name",
        "demo",
        ...(issue ? ["--issue", "42"] : []),
        "Demo",
      ], dir),
  },
  ...(PWSH_AVAILABLE
    ? [{
      name: "pwsh",
      create: (dir: string, number: string, issue: boolean) =>
        run("pwsh", [
          "-NoProfile",
          "-File",
          join(dir, ".specnaut/scripts/powershell/create-new-feature.ps1"),
          "-Json",
          "-Number",
          number,
          "-ShortName",
          "demo",
          ...(issue ? ["-Issue", "42"] : []),
          "Demo",
        ], dir),
    }]
    : []),
];

/** Each stub prints the marker on stdout and on stderr, then exits 0. */
const stub = (stdout: string) =>
  `#!/usr/bin/env bash\necho ${JSON.stringify(stdout)}\necho "${MARKER}-err" >&2\nexit 0\n`;

/** A repository with one commit on `main`, both twins installed, and stub backlog helpers. */
async function withRepo(parent: string, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "helper-text-twins-" }));
  try {
    await git(dir, "init", "-q", "-b", "main");
    await git(dir, "config", "commit.gpgsign", "false");
    await Deno.writeTextFile(join(dir, "README.md"), "x\n");
    await git(dir, "add", "README.md");
    await git(dir, "commit", "-q", "-m", "base");
    await copy(SCRIPTS, join(dir, ".specnaut/scripts"));
    const backlog = join(dir, ".specnaut/scripts/backlog");
    await Deno.mkdir(backlog, { recursive: true });
    for (
      const [name, out] of [
        ["parent-of.sh", parent],
        ["cascade-check.sh", `${MARKER}-cascade`],
        ["move.sh", `${MARKER}-moved`],
      ]
    ) {
      await Deno.writeTextFile(join(backlog, name), stub(out));
      await Deno.chmod(join(backlog, name), 0o755);
    }
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function assertNoMarker(r: Run): void {
  assert(!r.stdout.includes(MARKER), `a helper's text reached stdout: ${r.stdout}`);
  assert(!r.stderr.includes(MARKER), `a helper's text reached stderr: ${r.stderr}`);
}

for (const twin of TWINS) {
  Deno.test(`helper text [${twin.name}]: a parent that is not a number is no parent, and a move is fixed text`, () =>
    // A parent that is not a number: an answer this run cannot use.
    withRepo(`${MARKER}-epic`, async (dir) => {
      const r = await twin.create(dir, "1", true);
      assertEquals(r.code, 0, r.stderr);
      assertNoMarker(r);
      assertStringIncludes(r.stderr, "could not resolve the parent of issue 42");
      assertStringIncludes(r.stderr, "# issue 42 moved to In progress");
      assertEquals(await git(dir, "rev-parse", "--abbrev-ref", "HEAD"), "001-demo");
    }));

  Deno.test(`helper text [${twin.name}]: a parent is read from stdout alone, as a plain number`, () =>
    // Read with its stderr, the number was `<noise>\n007` and named no parent.
    // The local backend pads it (`parent: "#007"`); the feature.json an epic
    // branch carries links 7, so 007 is passed on as 7.
    withRepo("007", async (dir) => {
      const r = await twin.create(dir, "1", true);
      assertEquals(r.code, 0, r.stderr);
      assertNoMarker(r);
      assertStringIncludes(r.stderr, "# issue 42 is a child of epic #7 ");
      assertStringIncludes(r.stderr, "# issue 7 moved to In progress");
    }));

  Deno.test(`helper text [${twin.name}]: a --number that is not a whole number is refused`, () =>
    withRepo("7", async (dir) => {
      // Bash evaluated it as arithmetic: `1+1` made branch 002.
      const r = await twin.create(dir, "1+1", false);
      assertNotEquals(r.code, 0, r.stdout);
      assertEquals(await git(dir, "branch", "--list", "002-*"), "");
      assertEquals(await git(dir, "rev-parse", "--abbrev-ref", "HEAD"), "main");
    }));
}
