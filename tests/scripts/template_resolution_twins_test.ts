// cli#757 — `resolve_template` and `Resolve-Template` read a `.registry` in one
// of three states, the same in both twins. Parsed: exactly its enabled presets
// are searched, possibly none. Absent or blank: directory order. Malformed —
// JSON that is not a registry included — directory order too. A registry that
// parses and enables nothing used to read, in PowerShell, as one that is absent,
// so a disabled preset supplied the template.
//
// A malformed registry says so (cli#754): one fixed-text line on stderr, the
// same from both twins, once per run; every other state is quiet.
//
// One scenario list over both twins, so an expected value cannot differ per twin.

import { assert, assertEquals } from "@std/assert";
import { copy } from "@std/fs";
import { fromFileUrl, join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { git, type Run, run, slashes } from "./git_sandbox.ts";
import { guardPowerShellArm, PWSH_AVAILABLE } from "./pwsh_arm.ts";

const SCRIPTS = fromFileUrl(new URL("../../templates/core/specnaut/scripts/", import.meta.url));
const BASH = Deno.build.os === "darwin" ? "/bin/bash" : "bash";

guardPowerShellArm();

/**
 * The bash twin reads `.registry` with python3 and, without it, takes directory
 * order whatever the file says: its rows would prove nothing there. CI has it.
 */
const PYTHON3 = (await run(BASH, ["-c", "python3 -c 'import json'"], ".")).code === 0;

Deno.test("the bash arm's python3 is present where it must be", () => {
  if (Deno.env.get("CI") === "true") assert(PYTHON3, "python3 is absent on CI");
  if (!PYTHON3) console.warn("  note: python3 is absent — the bash arm did not run");
});

const TWINS = [
  ...(PYTHON3
    ? [{
      name: "bash",
      resolve: (project: string) =>
        run(BASH, [
          "-c",
          `source '${bashPath(join(SCRIPTS, "bash/common.sh"))}'
p=$(resolve_template x "$1") || p=none
printf 'RESULT found=%s\\n' "$p"`,
          "_",
          bashPath(project),
        ], project),
    }]
    : []),
  ...(PWSH_AVAILABLE
    ? [{
      name: "pwsh",
      resolve: (project: string) =>
        run("pwsh", [
          "-NoProfile",
          "-Command",
          `. '${join(SCRIPTS, "powershell/common.ps1")}'
$p = Resolve-Template -TemplateName x -RepoRoot '${project}'
"RESULT found=$(if ($p) { $p } else { 'none' })"`,
        ], project),
    }]
    : []),
];

/** What the twins return: a preset's template, by the preset's id, or none. */
type Found = "a" | "zeta" | "none";

const SCENARIOS: Array<{ label: string; registry?: string; found: Found; warns?: boolean }> = [
  { label: "a registry with no presets searches none", registry: `{"presets":{}}`, found: "none" },
  {
    label: "a registry whose only preset is disabled searches none",
    registry: `{"presets":{"a":{"enabled":false}}}`,
    found: "none",
  },
  { label: "a registry with no presets key searches none", registry: `{}`, found: "none" },
  {
    label: "an enabled-by-default preset is searched",
    registry: `{"presets":{"a":{}}}`,
    found: "a",
  },
  {
    label: "priority orders the presets, against directory order",
    registry: `{"presets":{"zeta":{"priority":5},"a":{}}}`,
    found: "zeta",
  },
  {
    label: "a registry that does not parse takes directory order",
    registry: `{not json`,
    found: "a",
    warns: true,
  },
  {
    label: "a top-level array is not a registry: directory order",
    registry: `[]`,
    found: "a",
    warns: true,
  },
  {
    label: "a presets array is not a registry: directory order",
    registry: `{"presets":[]}`,
    found: "a",
    warns: true,
  },
  { label: "no registry takes directory order", found: "a" },
  { label: "an empty registry takes directory order", registry: "", found: "a" },
  { label: "a blank registry takes directory order", registry: "  \n", found: "a" },
];

/** Presets `a` and `zeta` each holding `templates/x.md`; `a` comes first in directory order. */
async function withPresets(registry: string | undefined, fn: (p: string) => Promise<void>) {
  const project = await Deno.realPath(await Deno.makeTempDir({ prefix: "template-twins-" }));
  try {
    for (const id of ["a", "zeta"]) {
      const templates = join(project, ".specnaut/presets", id, "templates");
      await Deno.mkdir(templates, { recursive: true });
      await Deno.writeTextFile(join(templates, "x.md"), `# ${id}\n`);
    }
    if (registry !== undefined) {
      await Deno.writeTextFile(join(project, ".specnaut/presets/.registry"), registry);
    }
    await fn(project);
  } finally {
    await Deno.remove(project, { recursive: true });
  }
}

const found = (r: Run) =>
  r.stdout.split(/\r?\n/).filter((l) => l.startsWith("RESULT found=")).map((l) => l.slice(13));

for (const twin of TWINS) {
  for (const s of SCENARIOS) {
    Deno.test(`template resolution [${twin.name}]: ${s.label}`, () =>
      withPresets(s.registry, async (project) => {
        const r = await twin.resolve(project);
        const want = s.found === "none"
          ? "none"
          : slashes(join(project, ".specnaut/presets", s.found, "templates/x.md"));
        assertEquals(
          found(r).map((p) => p === "none" ? p : slashes(p)),
          [want],
          `stdout: ${r.stdout}\nstderr: ${r.stderr}`,
        );
        assertEquals(warnings(r), s.warns ? [MALFORMED] : [], r.stderr);
      }));
  }
}

const MALFORMED =
  "WARNING: .specnaut/presets/.registry could not be parsed; using alphabetical preset order";

const warnings = (r: Run) => r.stderr.split(/\r?\n/).filter((l) => l.startsWith("WARNING:"));

/**
 * The whole run (A5): `setup-plan` on a feature branch with no plan yet, so
 * it resolves the plan template through the registry. The installed scripts
 * are both twins'; the preset `a` holds the plan template.
 */
async function withFeature(registry: string, fn: (dir: string) => Promise<void>) {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "template-twins-run-" }));
  try {
    await copy(SCRIPTS, join(dir, ".specnaut/scripts"));
    const templates = join(dir, ".specnaut/presets/a/templates");
    await Deno.mkdir(templates, { recursive: true });
    await Deno.writeTextFile(join(templates, "plan-template.md"), "# Preset plan\n");
    await Deno.writeTextFile(join(dir, ".specnaut/presets/.registry"), registry);
    await git(dir, "init", "-q", "-b", "001-demo");
    await git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "x");
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const SETUP_PLAN = [
  ...(PYTHON3
    ? [{
      name: "bash",
      run: (dir: string) =>
        run(BASH, [bashPath(join(dir, ".specnaut/scripts/bash/setup-plan.sh")), "--json"], dir),
    }]
    : []),
  ...(PWSH_AVAILABLE
    ? [{
      name: "pwsh",
      run: (dir: string) =>
        run("pwsh", [
          "-NoProfile",
          "-File",
          join(dir, ".specnaut/scripts/powershell/setup-plan.ps1"),
          "-Json",
        ], dir),
    }]
    : []),
];

for (const twin of SETUP_PLAN) {
  Deno.test(`template resolution [${twin.name}]: setup-plan warns once of a malformed registry, in fixed text`, () =>
    // A raw ESC and a marker in a key: what a parser's message would quote.
    withFeature(`{"presets": {"MARKER-\u001b[31m": {`, async (dir) => {
      const r = await twin.run(dir);
      assertEquals(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
      assertEquals(warnings(r), [MALFORMED], r.stderr);
      assert(!r.stderr.includes("MARKER"), `the key reached stderr: ${r.stderr}`);
      assert(!r.stderr.includes("\u001b"), `an ESC reached stderr: ${JSON.stringify(r.stderr)}`);
      // The directory order still answered.
      const plan = await Deno.readTextFile(join(dir, ".specnaut/specs/001-demo/plan.md"));
      assertEquals(plan, "# Preset plan\n");
    }));

  Deno.test(`template resolution [${twin.name}]: setup-plan is quiet on a blank registry`, () =>
    withFeature("  \n", async (dir) => {
      const r = await twin.run(dir);
      assertEquals(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
      assertEquals(warnings(r), [], r.stderr);
      const plan = await Deno.readTextFile(join(dir, ".specnaut/specs/001-demo/plan.md"));
      assertEquals(plan, "# Preset plan\n");
    }));
}
