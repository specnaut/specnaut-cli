// The git variables a script inherits are dropped in one place, explicit_head_clear_env, and all
// of them: not only the ones `git rev-parse --local-env-vars` lists, which leaves out variables
// that still change what git answers, such as GIT_ICASE_PATHSPECS. The gate's git, in both twins,
// drops the same set. A variable that cannot be dropped, being readonly, is a failure.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { BOUNDARIES_CONFIG_PATH } from "../../src/domain/constitution_paths.ts";
import { IDENTITY, run } from "../templates/child_fixture.ts";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { PWSH_AVAILABLE } from "./epic_repo.ts";
import { bashScript, git } from "./explicit_head_fixture.ts";

const script = (dir: string, name: string) =>
  fromFileUrl(new URL(`../../templates/core/specnaut/scripts/${dir}/${name}`, import.meta.url));
const LIBRARY = bashPath(script("bash", "_explicit_head.sh"));
const GATE = bashPath(script("bash", "_gate_candidate.sh"));
const GATE_PS1 = script("powershell", "_gate_candidate.ps1");
const BOUNDARY = script("bash", "boundary-check.sh");

/** Not in `--local-env-vars`, and it makes `README.MD` name `README.md`. */
const ICASE = { GIT_ICASE_PATHSPECS: "1" };

const made: string[] = [];

/** `fn`, then every folder it made removed, whatever it threw. */
const scoped = (fn: () => Promise<void>) => async () => {
  try {
    await fn();
  } finally {
    for (const dir of made.splice(0)) await Deno.remove(dir, { recursive: true });
  }
};

/** A committed repository holding `README.md` and a domain file. */
async function project(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "explicit-head-env-" });
  made.push(root);
  await git(root, "init", "-q");
  await Deno.mkdir(join(root, "src/domain"), { recursive: true });
  await Deno.writeTextFile(join(root, "README.md"), "an invented project\n");
  await Deno.writeTextFile(join(root, "src/domain/a.ts"), 'import x from "web-framework";\n');
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "init");
  return root;
}

/** The control: plain git, given the variable, does read `README.MD` as `README.md`. */
async function assertIcaseMatters(root: string): Promise<void> {
  const plain = await run("git", ["ls-files", "--", "README.MD"], root, IDENTITY);
  assertEquals(plain.stdout, "", "without the variable, nothing matches");
  const icase = await run("git", ["ls-files", "--", "README.MD"], root, { ...IDENTITY, ...ICASE });
  assertEquals(icase.stdout, "README.md\n", "with it, git matches the other case");
}

Deno.test(
  "gate git (bash): no inherited GIT_* variable reaches it, listed by git or not",
  scoped(async () => {
    const root = await project();
    await assertIcaseMatters(root);
    const probe = '. "$1" || exit 70; REPO_ROOT="$2"; gate_git ls-files -- README.MD';
    const r = await run("bash", ["-c", probe, "_", GATE, bashPath(root)], root, ICASE);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(r.stdout, "");
  }),
);

Deno.test({
  name: "gate git (pwsh): no inherited GIT_* variable reaches it, listed by git or not",
  ignore: !PWSH_AVAILABLE,
  fn: scoped(async () => {
    const root = await project();
    await assertIcaseMatters(root);
    const probe = "$repoRoot = $env:PROBE_ROOT; . $env:PROBE_LIB; " +
      "$r = Invoke-GateGit @('ls-files', '--', 'README.MD'); \"code=$($r.Code) out=[$($r.Out)]\"";
    const env = { ...ICASE, PROBE_ROOT: root, PROBE_LIB: GATE_PS1 };
    const r = await run("pwsh", ["-NoProfile", "-NonInteractive", "-Command", probe], root, env);
    assertEquals(r.stdout.trim(), "code=0 out=[]", r.stderr);
  }),
});

/** A BASH_ENV that makes the inherited GIT_DIR readonly before the script's first line runs. */
async function readonlyGitDir(): Promise<Record<string, string>> {
  const other = await project();
  const file = join(other, "readonly.sh");
  await Deno.writeTextFile(file, "readonly GIT_DIR\n");
  return { BASH_ENV: bashPath(file), GIT_DIR: bashPath(join(other, ".git")) };
}

Deno.test(
  "explicit head: a GIT_* variable that cannot be unset fails the clearing",
  scoped(async () => {
    const root = await project();
    const probe = '. "$1" || exit 70; explicit_head_clear_env; echo "rc=$?"';
    const r = await run("bash", ["-c", probe, "_", LIBRARY], root, await readonlyGitDir());
    assertEquals(r.stdout.trim(), "rc=1", r.stderr);
  }),
);

Deno.test(
  "boundary check: a GIT_* variable it cannot drop stops the check",
  scoped(async () => {
    const root = await project();
    const config = "domain:\n  - 'src/domain'\nforbid:\n  - 'web-framework'\n";
    await Deno.mkdir(join(root, dirname(BOUNDARIES_CONFIG_PATH)), { recursive: true });
    await Deno.writeTextFile(join(root, BOUNDARIES_CONFIG_PATH), config);
    const r = await bashScript(BOUNDARY, [], root, await readonlyGitDir());
    assertEquals(r.code, 2, r.stdout + r.stderr);
    assertStringIncludes(r.stderr, "boundary-check: an inherited GIT_* variable cannot be dropped");
  }),
);
