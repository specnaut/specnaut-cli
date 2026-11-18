import { join } from "@std/path";
import { specnautOnPath } from "./specnaut_shim.ts";

/**
 * How a test runs a child process against git: argv only, never a shell string, from an
 * environment no developer setting or harness variable reaches. Shared by the merge scripts'
 * sandbox (`git_sandbox.ts`) and every fixture that runs git or a script on its own.
 */

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * One HOME for every child of this process, empty and outside any repository:
 * the developer's `~/.gitconfig` (an alias, `init.defaultBranch`, a signing
 * key, `url.*.insteadOf`) must not decide what a merge script does here.
 */
let isolatedHome: string | undefined;
function home(): string {
  if (!isolatedHome) {
    const dir = Deno.makeTempDirSync({ prefix: "specnaut-merge-home-" });
    isolatedHome = dir;
    globalThis.addEventListener("unload", () => {
      try {
        Deno.removeSync(dir, { recursive: true });
      } catch (e) {
        console.warn(`git_hermetic: could not remove ${dir}: ${e}`);
      }
    });
  }
  return isolatedHome;
}

/**
 * The environment a child starts from: the parent's, minus every `GIT_*` variable (a `GIT_DIR`, a
 * `GIT_CONFIG_COUNT` pair, a hook's `GIT_INDEX_FILE`), with an isolated HOME, no global or system
 * config, and the C locale — so an assertion on git's own wording holds in any language (cli#711).
 * Minus, too, what a harness exports to its shell (spec 048): this suite runs inside one, and its
 * session id would let the landing hold decide a case no test set. `specnaut` is first on the PATH.
 */
const HARNESS_ENV = /^(GIT_|CLAUDE_CODE_SESSION_ID$|CODEX_SESSION_ID$|CLAUDECODE$|CODEX_SANDBOX)/i;
export function hermetic(): Record<string, string> {
  const base = Object.fromEntries(
    Object.entries(Deno.env.toObject()).filter(([k]) => !HARNESS_ENV.test(k)),
  );
  const h = home();
  return specnautOnPath({
    ...base,
    HOME: h,
    USERPROFILE: h,
    XDG_CONFIG_HOME: join(h, ".config"),
    GIT_CONFIG_GLOBAL: join(h, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    LC_ALL: "C",
    LANG: "C",
  });
}

export async function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<Run> {
  const out = await new Deno.Command(cmd, {
    args,
    cwd,
    clearEnv: true,
    env: {
      ...hermetic(),
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.test",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.test",
      ...env,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await run("git", args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}
