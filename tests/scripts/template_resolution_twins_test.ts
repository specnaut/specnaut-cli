// cli#757 — `resolve_template` and `Resolve-Template` read a `.registry` in one
// of three states, the same in both twins. Parsed: exactly its enabled presets
// are searched, possibly none. Absent or blank: directory order. Malformed —
// JSON that is not a registry included — directory order too. A registry that
// parses and enables nothing used to read, in PowerShell, as one that is absent,
// so a disabled preset supplied the template.
//
// One scenario list over both twins, so an expected value cannot differ per twin.

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { type Run, run, slashes } from "./git_sandbox.ts";
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

const SCENARIOS: Array<{ label: string; registry?: string; found: Found }> = [
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
  },
  { label: "a top-level array is not a registry: directory order", registry: `[]`, found: "a" },
  {
    label: "a presets array is not a registry: directory order",
    registry: `{"presets":[]}`,
    found: "a",
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
      }));
  }
}
