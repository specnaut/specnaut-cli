import { DELIMITER, join } from "@std/path";
import { IDENTITY, type Result, run } from "../templates/child_fixture.ts";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";

/**
 * The shared setup of the explicit-head tests: a project repository, and a head commit whose
 * objects live only in a separate bare repository that borrows the project's objects, as a
 * repository fetched for one branch does. The project never holds the head, so a script that
 * reads it correctly can only have read it from the objects folder it was given; and the
 * project's HEAD, index and work tree are kept different from the head, so a script that read
 * any of them reports something the head does not hold.
 */

export type HeadRepo = {
  /** The project: on `main`, its work tree clean unless a test changes it. */
  readonly root: string;
  /** The commit `main` held when the head branched from it. */
  readonly base: string;
  /** The head's full id, absent from the project's own objects. */
  readonly head: string;
  /** The bare repository's objects folder, forward slashes on Windows. */
  readonly objects: string;
};

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await run("git", args, cwd, IDENTITY);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const at = join(root, path);
    await Deno.mkdir(join(at, ".."), { recursive: true });
    await Deno.writeTextFile(at, content);
  }
}

async function commitAll(root: string, message: string): Promise<string> {
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "--allow-empty", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

/**
 * `baseFiles` on `main`; then the head commits `headFiles` on top of it in a throwaway clone and
 * is pushed into the bare repository only; then `main` moves on with `mainFiles`, so HEAD is
 * neither the base nor the head.
 */
export async function headRepo(
  baseFiles: Record<string, string>,
  headFiles: Record<string, string>,
  mainFiles: Record<string, string> = { "MAIN_ONLY.md": "main moved on\n" },
): Promise<HeadRepo> {
  const root = await Deno.makeTempDir({ prefix: "explicit-head-" });
  await git(root, "init", "-q", "-b", "main");
  await git(root, "config", "core.autocrlf", "false");
  await writeFiles(root, { "README.md": "an invented project\n", ...baseFiles });
  const base = await commitAll(root, "base");

  const { head, objects } = await exportHead(root, headFiles);
  await writeFiles(root, mainFiles);
  await commitAll(root, "main moves on");
  const missing = await run("git", ["cat-file", "-e", `${head}^{commit}`], root, IDENTITY);
  if (missing.code === 0) throw new Error("the fixture's head leaked into the project");
  return { root, base, head, objects };
}

/**
 * A commit of `files` on top of `root`'s HEAD, made in a throwaway clone and pushed only into a
 * new bare repository that borrows `root`'s objects. `side` is the folder holding that repository.
 */
export async function exportHead(
  root: string,
  files: Record<string, string>,
): Promise<{ head: string; objects: string; side: string }> {
  const side = await Deno.makeTempDir({ prefix: "explicit-head-side-" });
  const clone = join(side, "clone");
  await git(side, "clone", "-q", "--no-hardlinks", root, clone);
  await git(clone, "config", "core.autocrlf", "false");
  await writeFiles(clone, files);
  const head = await commitAll(clone, "the head's change");
  const bare = join(side, "export.git");
  await git(side, "init", "-q", "--bare", bare);
  const own = (await git(root, "rev-parse", "--path-format=absolute", "--git-common-dir"))
    .replaceAll("\\", "/");
  await Deno.writeTextFile(join(bare, "objects", "info", "alternates"), `${own}/objects\n`);
  await git(clone, "push", "-q", bare, `${head}:refs/heads/fetched`);
  await Deno.remove(clone, { recursive: true });
  return { head, objects: bashPath(join(bare, "objects")), side };
}

/** A bash script run from `cwd`, arguments whole on Windows too. */
export function bashScript(
  script: string,
  args: string[],
  cwd: string,
  extra: Record<string, string> = {},
): Promise<Result> {
  const env: Record<string, string> = { ...IDENTITY, ...extra };
  if (Deno.build.os === "windows") env.MSYS = "noglob";
  return run("bash", [bashPath(script), ...args], cwd, env);
}

/** One git call a script made: the objects folder it was given, and its arguments. */
export type GitCall = { readonly alternates: string; readonly args: string };

/**
 * A `git` placed first on the PATH that records each call and then runs the real one, so a test
 * sees every git call a script makes, not only the ones it thought of. `env` puts it on the PATH
 * under the name the platform already uses for it. Git for Windows' bash puts its own git first,
 * so a test of it skips Windows (`gitRecorderUnsure`).
 */
export async function gitRecorder(): Promise<
  { env: Record<string, string>; calls: () => Promise<GitCall[]> }
> {
  const dir = await Deno.makeTempDir({ prefix: "explicit-head-git-" });
  const log = join(dir, "calls");
  const shim = join(dir, "git");
  await Deno.writeTextFile(
    shim,
    [
      "#!/usr/bin/env bash",
      'printf \'%s\\t%s\\n\' "${GIT_ALTERNATE_OBJECT_DIRECTORIES:-}" "$*" >>"$EXPLICIT_HEAD_GIT_LOG"',
      'PATH="${PATH#*:}"',
      'exec git "$@"',
      "",
    ].join("\n"),
  );
  await Deno.chmod(shim, 0o755);
  await Deno.writeTextFile(log, "");
  const key = Object.keys(Deno.env.toObject()).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const env = {
    [key]: `${dir}${DELIMITER}${Deno.env.get("PATH") ?? ""}`,
    EXPLICIT_HEAD_GIT_LOG: log,
  };
  const calls = async () =>
    (await Deno.readTextFile(log)).split("\n").filter(Boolean).map((line) => {
      const [alternates, ...rest] = line.split("\t");
      return { alternates, args: rest.join("\t") };
    });
  return { env, calls };
}

export const gitRecorderUnsure = Deno.build.os === "windows";

/** The settings every git call given an objects folder must carry. */
export const NO_GRAPHS = "-c core.commitGraph=false -c core.multiPackIndex=false";

/**
 * Every recorded call that read an objects folder carried NO_GRAPHS, and at least one did: a
 * script that never reached git with the folder proves nothing.
 */
export function assertNoGraphs(calls: GitCall[], what: string): void {
  const given = calls.filter((c) => c.alternates !== "");
  if (given.length === 0) throw new Error(`${what}: no git call was given the objects folder`);
  const bare = given.filter((c) => !c.args.startsWith(`${NO_GRAPHS} `));
  if (bare.length > 0) {
    throw new Error(`${what}: read the objects folder with its graphs on: ${bare[0].args}`);
  }
}
