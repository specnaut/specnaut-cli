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
import { join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { git, type Run, run } from "./git_sandbox.ts";
import { slashes } from "./twin_paths.ts";
import { guardPowerShellArm } from "./pwsh_arm.ts";
import { BASH, results, SCRIPTS, twins, warnings } from "./twin_runner.ts";

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

/** The template `x` as each twin resolves it for `project`, or `none`. */
const resolve = (project: string) => ({
  bash: `p=$(resolve_template x '${bashPath(project)}') || p=none
printf 'RESULT found=%s\\n' "$p"`,
  pwsh: `$p = Resolve-Template -TemplateName x -RepoRoot '${project}'
"RESULT found=$(if ($p) { $p } else { 'none' })"`,
});

/** What the twins return: a preset's template, by the preset's id, or none. */
type Found = "a" | "zeta" | "none";

/**
 * A file this process cannot open is a mode, and only a non-root POSIX user is
 * refused by one: Windows keeps no mode bits, and root reads any file.
 */
const UNREADABLE_OK = Deno.build.os !== "windows" &&
  (await run("id", ["-u"], ".").catch(() => undefined))?.stdout.trim() !== "0";

const SCENARIOS: Array<
  { label: string; registry?: string; found: Found; warns?: boolean; unreadable?: boolean }
> = [
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
  {
    // cli#763: what it would say if read enables nothing, so a read shows.
    label: "a registry that cannot be read is malformed: directory order (POSIX)",
    registry: `{"presets":{}}`,
    unreadable: true,
    found: "a",
    warns: true,
  },
  { label: "no registry takes directory order", found: "a" },
  { label: "an empty registry takes directory order", registry: "", found: "a" },
  { label: "a blank registry takes directory order", registry: "  \n", found: "a" },
];

/** Presets `a` and `zeta` each holding `templates/x.md`; `a` comes first in directory order. */
async function withPresets(s: (typeof SCENARIOS)[number], fn: (p: string) => Promise<void>) {
  const project = await Deno.realPath(await Deno.makeTempDir({ prefix: "template-twins-" }));
  try {
    for (const id of ["a", "zeta"]) {
      const templates = join(project, ".specnaut/presets", id, "templates");
      await Deno.mkdir(templates, { recursive: true });
      await Deno.writeTextFile(join(templates, "x.md"), `# ${id}\n`);
    }
    const registry = join(project, ".specnaut/presets/.registry");
    if (s.registry !== undefined) await Deno.writeTextFile(registry, s.registry);
    if (s.unreadable) await Deno.chmod(registry, 0o000);
    await fn(project);
  } finally {
    await Deno.remove(project, { recursive: true });
  }
}

const found = (r: Run) => results(r).filter((l) => l.startsWith("found=")).map((l) => l.slice(6));

for (const twin of twins(PYTHON3)) {
  for (const s of SCENARIOS) {
    Deno.test({
      name: `template resolution [${twin.name}]: ${s.label}`,
      ignore: s.unreadable && !UNREADABLE_OK,
      fn: () =>
        withPresets(s, async (project) => {
          const r = await twin.functions(SCRIPTS, resolve(project), project);
          const want = s.found === "none"
            ? "none"
            : slashes(join(project, ".specnaut/presets", s.found, "templates/x.md"));
          assertEquals(
            found(r).map((p) => p === "none" ? p : slashes(p)),
            [want],
            `stdout: ${r.stdout}\nstderr: ${r.stderr}`,
          );
          // The whole of stderr: the one fixed line, or nothing; never a reader's own text.
          assertEquals(r.stderr.split(/\r?\n/).filter(Boolean), s.warns ? [MALFORMED] : []);
        }),
    });
  }
}

const MALFORMED =
  "WARNING: .specnaut/presets/.registry could not be parsed; using alphabetical preset order";

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

for (const twin of twins(PYTHON3)) {
  Deno.test(`template resolution [${twin.name}]: setup-plan warns once of a malformed registry, in fixed text`, () =>
    // A raw ESC and a marker in a key: what a parser's message would quote.
    withFeature(`{"presets": {"MARKER-\u001b[31m": {`, async (dir) => {
      const r = await twin.entry(join(dir, ".specnaut/scripts"), "setup-plan", ["--json"], dir);
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
      const r = await twin.entry(join(dir, ".specnaut/scripts"), "setup-plan", ["--json"], dir);
      assertEquals(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
      assertEquals(warnings(r), [], r.stderr);
      const plan = await Deno.readTextFile(join(dir, ".specnaut/specs/001-demo/plan.md"));
      assertEquals(plan, "# Preset plan\n");
    }));
}
