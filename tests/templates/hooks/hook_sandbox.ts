import { fromFileUrl, isAbsolute, join } from "@std/path";

/**
 * Shared harness for the hook tests (spec 036). Every guard is a bash script
 * that reads a harness payload on stdin; the only honest test is to pipe a
 * payload shaped like the real one into the real script, inside a real git
 * repository, and read the exit code. Nothing here reimplements a guard rule.
 *
 * Hermetic on purpose: the child gets a cleared environment with HOME and the
 * git config locations pointed into a temp dir, so the developer's own
 * `init.defaultBranch` or git aliases can never decide a case.
 */

export const HOOKS_DIR = fromFileUrl(
  new URL("../../../templates/harness-specific/shared/hooks/", import.meta.url),
);
export const BASH_SCRIPTS_DIR = fromFileUrl(
  new URL("../../../templates/core/specnaut/scripts/bash/", import.meta.url),
);
const FIXTURES_DIR = fromFileUrl(new URL("../../fixtures/hooks/", import.meta.url));
const WINDOWS = Deno.build.os === "windows";

/**
 * A path as Git Bash takes it from us: forward slashes on Windows. A guard
 * finds `_guard.sh` by the last `/` of its own path, so `D:\a\guard.sh` sends
 * it looking in `.`; `D:/a/guard.sh` is still a Windows path, and absolute.
 * Elsewhere unchanged — on POSIX a `\` is a filename character.
 */
export function bashPath(p: string): string {
  return WINDOWS ? p.replaceAll("\\", "/") : p;
}

export type Harness = "claude" | "codex";
export const HARNESSES: readonly Harness[] = ["claude", "codex"];

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

export interface Sandbox {
  dir: string;
  home: string;
  env: Record<string, string>;
  cleanup(): Promise<void>;
}

/** A temp dir with its own HOME; `env` is what every child gets. */
export async function sandbox(): Promise<Sandbox> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "specnaut-hooks-" }));
  const home = join(dir, "home");
  await Deno.mkdir(home);
  const env: Record<string, string> = {
    PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin",
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    LC_ALL: "C",
  };
  return { dir, home, env, cleanup: () => Deno.remove(dir, { recursive: true }) };
}

async function exec(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; stdin?: string },
): Promise<Run> {
  const child = new Deno.Command(cmd, {
    args,
    cwd: opts.cwd,
    env: opts.env,
    clearEnv: true,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  try {
    if (opts.stdin !== undefined) await writer.write(new TextEncoder().encode(opts.stdin));
    await writer.close();
  } catch (e) {
    // A guard that refuses before it reads its payload has closed the pipe: its
    // exit code is the result. Anything else is a failure.
    if (!(e instanceof Deno.errors.BrokenPipe)) throw e;
  }
  const out = await child.output();
  const dec = new TextDecoder();
  return { code: out.code, stdout: dec.decode(out.stdout), stderr: dec.decode(out.stderr) };
}

/** Run git in `cwd` with the sandbox env; throws on a non-zero exit. */
export async function git(sb: Sandbox, cwd: string, ...args: string[]): Promise<string> {
  const r = await exec("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    env: sb.env,
  });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

export interface RepoOptions {
  /** The committed `merge:` value; `null` writes no workflow.yml. */
  mode?: string | null;
  /** The branch checked out at the end. */
  head?: string;
  /** What origin/HEAD points at; `null` leaves the base unknown. */
  base?: string | null;
}

let repoCount = 0;

/**
 * A git repo with `.specnaut/scripts/bash/{merge-mode,base-branch}.sh`
 * copied from the templates,
 * exactly as in a scaffolded project. origin/HEAD is set by ref, so no remote has to exist.
 */
export async function makeRepo(sb: Sandbox, opts: RepoOptions = {}): Promise<string> {
  const { mode = "manual", head = "feat", base = "main" } = opts;
  const repo = join(sb.dir, `repo-${++repoCount}`);
  await Deno.mkdir(join(repo, ".specnaut", "scripts", "bash"), { recursive: true });
  await git(sb, repo, "init", "-q", "-b", "main");
  for (const s of ["merge-mode.sh", "base-branch.sh"]) {
    await Deno.copyFile(join(BASH_SCRIPTS_DIR, s), join(repo, ".specnaut", "scripts", "bash", s));
  }
  if (mode !== null) {
    await Deno.writeTextFile(join(repo, ".specnaut", "workflow.yml"), `merge: ${mode}\n`);
  }
  const entry = (s: string) => `  .claude/skills/${s}/SKILL.md:\n    sha256: ${"0".repeat(64)}\n`;
  await Deno.writeTextFile(
    join(repo, ".specnaut", "installed.lock"),
    `version: 2\nharness: claude\nentries:\n${entry("task")}${entry("ship")}`,
  );
  await Deno.writeTextFile(join(repo, "README.md"), "# my-app\n");
  await git(sb, repo, "add", "-A");
  await git(sb, repo, "commit", "-q", "-m", "init");
  if (base !== null) {
    await git(sb, repo, "update-ref", `refs/remotes/origin/${base}`, "HEAD");
    await git(sb, repo, "symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${base}`);
  }
  if (head !== "main") await git(sb, repo, "checkout", "-q", "-b", head);
  return repo;
}

/** A fixture payload with `overrides` applied (top-level keys; `tool_input` replaced whole). */
export async function payload(
  harness: Harness,
  name: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const base = JSON.parse(await Deno.readTextFile(join(FIXTURES_DIR, harness, `${name}.json`)));
  return { ...base, ...overrides };
}

/**
 * Pipe `input` (an object is JSON-encoded) into `<hook> <harness>` — the
 * template's own copy, or the one in `opts.hooksDir` (a test's altered copy).
 * `opts.path` is handed to bash exactly as given, never through `bashPath`:
 * the one way a test reaches a guard by a path holding a `\` (cli#716). It
 * replaces `hooksDir`, so the two never come together, and it must name `hook`.
 */
export function runHook(
  sb: Sandbox,
  hook: string,
  harness: Harness,
  input: Record<string, unknown> | string,
  opts:
    & { cwd?: string; env?: Record<string, string> }
    & ({ hooksDir?: string; path?: never } | { path: string; hooksDir?: never }) = {},
): Promise<Run> {
  if (opts.path !== undefined) {
    // The type already forbids both; a cast must not get them past it either.
    if (opts.hooksDir !== undefined) throw new Error("runHook: opts.path replaces opts.hooksDir");
    const named = opts.path.endsWith(hook) && /[\\/]/.test(opts.path.at(-hook.length - 1) ?? "");
    if (!named) throw new Error(`runHook: opts.path ${opts.path} does not name ${hook}`);
  }
  const path = opts.path ?? bashPath(join(opts.hooksDir ?? HOOKS_DIR, hook));
  return exec("bash", [path, harness], {
    cwd: opts.cwd ?? sb.dir,
    env: { ...sb.env, ...opts.env },
    stdin: typeof input === "string" ? input : JSON.stringify(input),
  });
}

/** Run a script from `templates/core/specnaut/scripts/bash/` (or an absolute path) in `cwd`. */
export function runScript(
  sb: Sandbox,
  script: string,
  cwd: string,
  ...args: string[]
): Promise<Run> {
  const path = isAbsolute(script) ? script : join(BASH_SCRIPTS_DIR, script);
  return exec("bash", [bashPath(path), ...args], { cwd, env: sb.env });
}

/**
 * Run `fn` over `items`, at most `width` at a time. The table-driven cases are
 * independent reads of their repo, and each spawns several processes; run in
 * sequence, a long table is slow.
 */
export async function pool<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  width = 8,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return out;
}
