import { fromFileUrl } from "@std/path";

/**
 * A backlog backend's scripts laid out in a temp project, and a way to run
 * them. `_config.sh` resolves the project root three levels above its own
 * directory, so the scripts sit at `<tmp>/task/scripts/<backend>/` and the
 * config at `<tmp>/.specnaut/backlog-config.yml`.
 */

const SCRIPTS = "../../templates/core/skills/task/scripts";

/** The path of a bundled backlog script, relative to the scripts directory. */
export function scriptSource(rel: string): string {
  return fromFileUrl(new URL(`${SCRIPTS}/${rel}`, import.meta.url));
}

/**
 * Lays `backend`'s `_config.sh` out, plus `extra` (paths under the scripts
 * directory, copied flat beside it, as the manifest installs them), and drops
 * `config` as the project's backlog-config.yml when it is not null.
 */
export async function backendHarness(
  backend: string,
  config: string | null,
  extra: ReadonlyArray<string> = [],
): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: `backend-${backend}-` });
  const dir = backendDir(tmp, backend);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.mkdir(`${tmp}/.specnaut`, { recursive: true });
  await Deno.mkdir(`${tmp}/bin`, { recursive: true });
  for (const rel of [`${backend}/_config.sh`, ...extra]) {
    await Deno.copyFile(scriptSource(rel), `${dir}/${rel.split("/").pop()}`);
  }
  if (config !== null) {
    await Deno.writeTextFile(`${tmp}/.specnaut/backlog-config.yml`, config);
  }
  return tmp;
}

export function backendDir(tmp: string, backend: string): string {
  return `${tmp}/task/scripts/${backend}`;
}

/** A stand-in command on `<tmp>/bin`, a bash script with `body`. */
export async function stub(tmp: string, name: string, body: string): Promise<void> {
  await Deno.writeTextFile(`${tmp}/bin/${name}`, `#!/usr/bin/env bash\n${body}\n`);
  await Deno.chmod(`${tmp}/bin/${name}`, 0o755);
}

export type Run = { code: number; out: string; err: string };

/**
 * Runs `bash <script> <args>` with `<tmp>/bin` first on PATH. PATH goes through
 * the process environment, not an `export` inside the script: on Windows, bash
 * converts an inherited PATH to POSIX form at startup, but a native path
 * assigned inside the script is left as-is and the stub becomes unfindable.
 * That failure is silent where a helper degrades to no output, so a
 * degradation case would pass for the wrong reason. `path` replaces the
 * inherited PATH after `<tmp>/bin` when given.
 */
export async function runScript(
  tmp: string,
  script: string,
  args: ReadonlyArray<string> = [],
  path = Deno.env.get("PATH") ?? "",
): Promise<Run> {
  const { code, stdout, stderr } = await new Deno.Command("bash", {
    args: [script, ...args],
    env: { PATH: `${tmp}/bin:${path}` },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return { code, out: dec.decode(stdout).trim(), err: dec.decode(stderr) };
}

/**
 * Sources `_config.sh` from a probe script in the backend's own directory,
 * then runs `body`. Sourcing it from `bash -c` would make `$0` "bash" and
 * break the root lookup; this is how the real backend scripts consume it.
 */
export async function runSourced(tmp: string, backend: string, body: string): Promise<Run> {
  const probe = `${backendDir(tmp, backend)}/probe.sh`;
  await Deno.writeTextFile(
    probe,
    `#!/usr/bin/env bash\nset -euo pipefail\n. "$(dirname "$0")/_config.sh"\n${body}\n`,
  );
  return await runScript(tmp, probe);
}
