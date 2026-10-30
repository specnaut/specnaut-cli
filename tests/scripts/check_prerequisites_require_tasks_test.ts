// cli#709 — spec 041 folded `tasks` into `implement`, so `tasks.md` is never
// produced and `check-prerequisites` stopped requiring it. A project's
// customised `implement` doc may still pass `--require-tasks` (`-RequireTasks`
// in the PowerShell twin): the flag must be accepted, said on stderr — stdout
// carries the JSON the phase parses — and must not fail the run.
//
// Nothing ran either script before this file, so the flag's arm was guarded
// by nothing: deleting it would turn every such call into "Unknown option".

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const SCRIPTS = fromFileUrl(new URL("../../templates/core/specnaut/scripts/", import.meta.url));

type Result = { code: number; stdout: string; stderr: string };

async function exec(bin: string, argv: string[], cwd: string): Promise<Result> {
  const { code, stdout, stderr } = await new Deno.Command(bin, {
    args: argv,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  return { code, stdout: text(stdout), stderr: text(stderr) };
}

async function hasPwsh(): Promise<boolean> {
  try {
    return (await exec("pwsh", ["-NoProfile", "-Command", "exit 0"], ".")).code === 0;
  } catch (err) {
    console.warn(`  note: pwsh could not start (${err}) — PowerShell arm skipped`);
    return false;
  }
}

const PWSH_AVAILABLE = await hasPwsh();

/** One runner per twin; each carries its own spelling of the two flags. */
const RUNNERS = [
  {
    name: "bash",
    flags: { json: "--json", requireTasks: "--require-tasks" },
    run: (args: string[], cwd: string) =>
      exec("bash", [join(SCRIPTS, "bash", "check-prerequisites.sh"), ...args], cwd),
  },
  ...(PWSH_AVAILABLE
    ? [{
      name: "pwsh",
      flags: { json: "-Json", requireTasks: "-RequireTasks" },
      run: (args: string[], cwd: string) =>
        exec(
          "pwsh",
          ["-NoProfile", "-File", join(SCRIPTS, "powershell", "check-prerequisites.ps1"), ...args],
          cwd,
        ),
    }]
    : []),
];

Deno.test("the PowerShell arm runs where it must", () => {
  // GitHub-hosted runners ship pwsh on every OS: its absence on CI is a broken
  // environment, not a reason to halve what this file covers.
  if (Deno.env.get("CI") === "true") assert(PWSH_AVAILABLE, "pwsh is absent on CI");
});

/** A feature on its own branch with a plan and, deliberately, no `tasks.md`. */
async function withFeature(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "check-prereq-" });
  try {
    const git = async (...args: string[]) => {
      const r = await exec("git", args, dir);
      assertEquals(r.code, 0, `git ${args.join(" ")}: ${r.stderr}`);
    };
    await git("init", "-q", "-b", "001-alpha");
    await git(
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "root",
    );
    const feature = join(dir, ".specnaut", "specs", "001-alpha");
    await Deno.mkdir(feature, { recursive: true });
    await Deno.writeTextFile(join(feature, "plan.md"), "# Alpha\n");
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

for (const runner of RUNNERS) {
  Deno.test(`${runner.name}: the retired tasks flag is accepted, noted on stderr, and exits 0`, async () => {
    await withFeature(async (dir) => {
      const r = await runner.run([runner.flags.json, runner.flags.requireTasks], dir);
      assertEquals(r.code, 0, `exit ${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
      assertStringIncludes(r.stderr, `${runner.flags.requireTasks} is ignored`);
      // The note stays off stdout: the phase parses stdout as JSON.
      const out = JSON.parse(r.stdout.trim());
      assertEquals(out.AVAILABLE_DOCS, []);
      assert(String(out.FEATURE_DIR).endsWith("001-alpha"), `FEATURE_DIR: ${out.FEATURE_DIR}`);
    });
  });

  Deno.test(`${runner.name}: without the flag there is no note`, async () => {
    // The marker above is only the flag's: a run without it never prints it.
    await withFeature(async (dir) => {
      const r = await runner.run([runner.flags.json], dir);
      assertEquals(r.code, 0, `exit ${r.code}\nstderr: ${r.stderr}`);
      assertEquals(r.stderr.includes("is ignored"), false, r.stderr);
    });
  });
}
