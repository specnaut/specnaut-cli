import type { GitAdapter } from "../application/ports.ts";
import { type Dropped, filterGitPath, gitMissing } from "./git_path.ts";
import { programOnPath } from "./program_on_path.ts";
import { UNREACHABLE } from "./fs_containment.ts";

/**
 * git in the user's own project, for `specnaut init`. The project is the user's, not a checkout
 * nobody vetted, so its configuration is read as git reads it; but git is looked up as every git
 * the binary starts is, only on PATH entries outside the project's tree (`git_path.ts`), so a
 * `git` a cloned project carries in its folders is never the one that runs.
 */
export class DenoGit implements GitAdapter {
  /**
   * `here` is the folder whose tree `isAvailable` keeps git's PATH out of: the project `init`
   * works on, never the working folder by default, which `specnaut init <dir>` need not be in.
   */
  constructor(private readonly here: string) {}

  async isAvailable(): Promise<boolean> {
    const { command } = projectGit(this.here, ["--version"], "null");
    return (await answered(command))?.success ?? false;
  }

  async isInitialized(dir: string): Promise<boolean> {
    try {
      const stat = await Deno.lstat(`${dir}/.git`);
      return stat.isDirectory || stat.isFile;
    } catch (err) {
      // No `.git` this process can reach is no repository: `init` makes one or says why not.
      if (UNREACHABLE.some((c) => err instanceof c)) return false;
      throw err;
    }
  }

  async init(dir: string): Promise<void> {
    const { command, missing, dropped } = projectGit(dir, ["init", "--quiet"], "null");
    if (command === undefined) throw new Error(gitMissing(missing, dropped));
    const status = await answered(command);
    if (status === undefined) throw new Error(gitMissing(NOT_ON_PATH, dropped));
    if (!status.success) throw new Error("git init failed");
  }

  async getRemoteUrl(dir: string, remote: string): Promise<string | null> {
    const { command } = projectGit(dir, ["remote", "get-url", remote], "piped");
    const out = await answered(command);
    if (!out?.success) return null;
    const url = new TextDecoder().decode(out.stdout).trim();
    return url.length > 0 ? url : null;
  }
}

/**
 * The project's tags, for the version scheme `init` suggests: none when there is no git, no folder
 * yet (Windows says NotADirectory there), no repository or no tag: "no signal", never a failure.
 */
export function listTags(dir: string): string[] {
  const { command } = projectGit(dir, ["tag", "-l"], "piped");
  let out: Deno.CommandOutput | undefined;
  try {
    out = command?.outputSync();
  } catch (err) {
    if (!UNREACHABLE.some((c) => err instanceof c)) throw err;
  }
  if (!out?.success) return [];
  return new TextDecoder().decode(out.stdout).split("\n").map((s) => s.trim()).filter(Boolean);
}

/** A git command for `dir`, or none and why; the first entry left out. */
type ProjectGit = {
  readonly command: Deno.Command | undefined;
  readonly missing: string;
  readonly dropped?: Dropped;
};

/**
 * git in `dir` with the caller's environment, its PATH kept outside `dir`'s tree, started by the
 * file found there (`programOnPath`): Windows would look in the working folder first, which is the
 * project. With no entry left, or no git on them, there is no command: an empty PATH can mean the
 * working folder too.
 */
function projectGit(dir: string, args: string[], stdout: "null" | "piped"): ProjectGit {
  const { kept, dropped } = filterGitPath(Deno.env.get("PATH") ?? "", dir);
  const git = programOnPath("git", kept);
  const missing = kept === "" ? "no PATH entry outside the repository" : NOT_ON_PATH;
  if (git === undefined) return { command: undefined, missing, dropped };
  // Every spelling of the caller's PATH goes: Windows would see `Path` and `PATH` as two.
  const env = Object.entries(Deno.env.toObject()).filter(([k]) => k.toUpperCase() !== "PATH");
  const command = new Deno.Command(git, {
    args,
    cwd: dir,
    clearEnv: true,
    env: { ...Object.fromEntries(env), PATH: kept },
    stdout,
    stderr: "null",
  });
  return { command, missing, dropped };
}

/** What `command` returned, or undefined when there is none or no git is found to run it. */
async function answered(
  command: Deno.Command | undefined,
): Promise<Deno.CommandOutput | undefined> {
  try {
    return await command?.output();
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return undefined;
    throw err;
  }
}

const NOT_ON_PATH = "git is not on the PATH";
