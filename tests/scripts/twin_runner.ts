import { fromFileUrl, join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { type Run, run } from "./git_sandbox.ts";
import { PWSH_AVAILABLE } from "./pwsh_arm.ts";

/**
 * The one runner the script-twin tables share (cli#761): a case runs against
 * the bash twin and the PowerShell twin through the same two calls, so a table
 * says what both owe once and cannot hold a runner that differs per file.
 */

/** The bundled scripts tree: `bash/` and `powershell/`, run in place. */
export const SCRIPTS = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/", import.meta.url),
);

/** macOS's stock bash, the 3.2 the twins' defects live on, whatever PATH finds first. */
export const BASH = Deno.build.os === "darwin" ? "/bin/bash" : "bash";

/** A snippet per twin, each in its own language. */
export type Bodies = { bash: string; pwsh: string };

export type Twin = {
  name: "bash" | "pwsh";
  /**
   * `body` in one shell with the twin's `common` sourced from `scripts` (a tree
   * holding `bash/` and `powershell/`), and `path`, when given, as the whole PATH.
   */
  functions: (scripts: string, body: Bodies, cwd: string, path?: string) => Promise<Run>;
  /** An entry script of `scripts` by its bash name, its flags spelled as bash's. */
  entry: (scripts: string, script: string, args: string[], cwd: string) => Promise<Run>;
};

/** `--short-name` → `-ShortName`: the PowerShell twin's spelling of a bash flag. */
export const pwshFlag = (a: string) =>
  a.startsWith("--")
    ? `-${a.slice(2).split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("")}`
    : a;

const BASH_TWIN: Twin = {
  name: "bash",
  functions: (scripts, body, cwd, path) =>
    run(BASH, [
      "-c",
      `${path === undefined ? "" : `PATH='${bashPath(path)}'\n`}source '${
        bashPath(join(scripts, "bash/common.sh"))
      }'\n${body.bash}`,
    ], cwd),
  entry: (scripts, script, args, cwd) =>
    run(BASH, [bashPath(join(scripts, "bash", `${script}.sh`)), ...args], cwd),
};

const PWSH_TWIN: Twin = {
  name: "pwsh",
  functions: (scripts, body, cwd, path) =>
    run("pwsh", [
      "-NoProfile",
      "-Command",
      `${path === undefined ? "" : `$env:PATH = '${path}'\n`}. '${
        join(scripts, "powershell/common.ps1")
      }'\n${body.pwsh}`,
    ], cwd),
  entry: (scripts, script, args, cwd) =>
    run("pwsh", [
      "-NoProfile",
      "-File",
      join(scripts, "powershell", `${script}.ps1`),
      ...args.map(pwshFlag),
    ], cwd),
};

/** The twins this host can run: bash when `bash` holds, PowerShell when pwsh starts. */
export function twins(bash = true): Twin[] {
  return [...(bash ? [BASH_TWIN] : []), ...(PWSH_AVAILABLE ? [PWSH_TWIN] : [])];
}

/** The `RESULT <value>` lines a snippet printed, without the prefix. */
export const results = (r: Run) =>
  r.stdout.split(/\r?\n/).filter((l) => l.startsWith("RESULT ")).map((l) => l.slice(7));

/** The `WARNING:` lines on stderr. */
export const warnings = (r: Run) => r.stderr.split(/\r?\n/).filter((l) => l.startsWith("WARNING:"));
