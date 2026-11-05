import { dirname, fromFileUrl, join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { ISOLATED, PWSH_AVAILABLE } from "./epic_repo.ts";

/**
 * The fixture every `run-gate` test shares: a throwaway project holding a real
 * copy of the shipped scripts, because `run-gate` finds the repository from
 * its own location, and both twins as runners. Every project and adapter in
 * here is invented. Children read no global or system git config and inherit no `GIT_*`
 * variable, as in `epic_repo.ts`, and every directory made here is removed on unload.
 */

const CORE = fromFileUrl(new URL("../../templates/core/specnaut/scripts/", import.meta.url));

export type Twin = "bash" | "pwsh";
export const TWINS: Twin[] = PWSH_AVAILABLE ? ["bash", "pwsh"] : ["bash"];
export type Result = { code: number; stdout: string; stderr: string };
export type RunOptions = { stdin?: string; env?: Record<string, string> };

const TEMP_DIRS: string[] = [];
globalThis.addEventListener("unload", () => {
  for (const dir of TEMP_DIRS) {
    try {
      Deno.removeSync(dir, { recursive: true });
    } catch (e) {
      // A leftover directory is no test's verdict, and a thrown error here would read as one.
      console.warn(`could not remove ${dir}: ${e}`);
    }
  }
});

/** A throwaway directory, by its real path: macOS's temp directory is reached through a link. */
export async function tempDir(prefix: string): Promise<string> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix }));
  TEMP_DIRS.push(dir);
  return dir;
}

/** `git` in `cwd`, isolated, and throwing when it fails. */
export async function gitIn(cwd: string, ...args: string[]): Promise<string> {
  const { code, stdout, stderr } = await new Deno.Command("git", {
    args,
    cwd,
    clearEnv: true,
    env: {
      ...ISOLATED,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${d.decode(stderr)}`);
  return d.decode(stdout).trim();
}

/** Copies the shipped scripts into `root/.specnaut/scripts`, as a scaffold does. */
export async function installScripts(root: string): Promise<void> {
  for (const shell of ["bash", "powershell"]) {
    const to = join(root, ".specnaut/scripts", shell);
    await Deno.mkdir(to, { recursive: true });
    for await (const e of Deno.readDir(join(CORE, shell))) {
      await Deno.copyFile(join(CORE, shell, e.name), join(to, e.name));
    }
  }
}

/** A throwaway project with the scripts installed and, when given, this `gates.yml`. */
export async function gateProject(gates?: string): Promise<string> {
  const root = await tempDir("run-gate-");
  await installScripts(root);
  if (gates !== undefined) await Deno.writeTextFile(join(root, ".specnaut/gates.yml"), gates);
  return root;
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await Deno.mkdir(dirname(join(root, path)), { recursive: true });
    await Deno.writeTextFile(join(root, path), content);
  }
}

/** Runs a process with `stdin` piped in, so a command reading it finds exactly this. */
export async function spawn(argv: string[], cwd: string, opts: RunOptions = {}): Promise<Result> {
  const child = new Deno.Command(argv[0], {
    args: argv.slice(1),
    cwd,
    clearEnv: true,
    env: { ...ISOLATED, NO_COLOR: "1", ...opts.env },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  // A process that never reads stdin may close it first; that is not a failure here.
  const closedFirst = (e: unknown) => {
    if (!(e instanceof Deno.errors.BrokenPipe)) throw e;
  };
  await writer.write(new TextEncoder().encode(opts.stdin ?? "")).catch(closedFirst);
  await writer.close().catch(closedFirst);
  const out = await child.output();
  const d = new TextDecoder();
  return { code: out.code, stdout: d.decode(out.stdout), stderr: d.decode(out.stderr) };
}

/** `run-gate` with `args`, from the copy installed in `root`, on the given twin. */
export function runGate(
  twin: Twin,
  root: string,
  args: string[],
  opts: RunOptions = {},
): Promise<Result> {
  const argv = twin === "bash"
    ? ["bash", bashPath(join(root, ".specnaut/scripts/bash/run-gate.sh"))]
    : ["pwsh", "-NoProfile", "-File", join(root, ".specnaut/scripts/powershell/run-gate.ps1")];
  return spawn([...argv, ...args], root, opts);
}

/** Normalizes what a Windows checkout or console may add; never what a test asserts on. */
export const lf = (s: string) => s.replaceAll("\r\n", "\n");
