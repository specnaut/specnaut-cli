import { DELIMITER, dirname, fromFileUrl, join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { PWSH_AVAILABLE } from "./epic_repo.ts";

/**
 * The fixture every `run-gate` test shares: a throwaway project holding a real
 * copy of the shipped scripts, because `run-gate` finds the repository from
 * its own location, and both twins as runners. Every project and adapter in
 * here is invented.
 */

const CORE = fromFileUrl(new URL("../../templates/core/specnaut/scripts/", import.meta.url));

export type Twin = "bash" | "pwsh";
export const TWINS: Twin[] = PWSH_AVAILABLE ? ["bash", "pwsh"] : ["bash"];
export type Result = { code: number; stdout: string; stderr: string };
export type RunOptions = { stdin?: string; env?: Record<string, string> };

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
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "run-gate-" }));
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
    env: { NO_COLOR: "1", ...opts.env },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  // A process that never reads stdin may close it first; that is not a failure here.
  await writer.write(new TextEncoder().encode(opts.stdin ?? "")).catch(() => {});
  await writer.close().catch(() => {});
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

/** PATH with `dir` first, for a test that shadows a tool. */
export const pathWith = (dir: string) => `${dir}${DELIMITER}${Deno.env.get("PATH")}`;

/** Normalizes what a Windows checkout or console may add; never what a test asserts on. */
export const lf = (s: string) => s.replaceAll("\r\n", "\n");
