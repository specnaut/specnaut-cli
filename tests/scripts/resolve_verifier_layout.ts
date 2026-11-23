import { join } from "@std/path";
import { toolsIn } from "../integration/hook_tools.ts";
import { git, run } from "./git_sandbox.ts";

/**
 * The folders the PATH check's table runs in (resolve_verifier_test.ts): a repository whose folders
 * hold a marker for every command the spellings run, `specnaut` stubs outside and beside it,
 * links across its edge both ways, a folder holding only the real tools, and a held lock's copy.
 */

/** Every name a script of the table runs, planted where a PATH entry it must not trust points. */
const EXTERNALS = "cat env git rm dirname readlink sed grep awk bash specnaut".split(" ");

/** The folders and files the cases name, all under one physical temp folder. */
export type Layout = {
  tmp: string;
  repo: string;
  /** The folder of the tree that holds a marker for every external, `specnaut` included. */
  bin: string;
  /** A submodule's work tree in the repository: its `.git` is a file, its git folder the top's. */
  submodule: string;
  tools: string;
  outside: string;
  sibling: string;
  state: string;
  caseBlind: boolean;
};

/** Writes an executable `name` in `dir`, made first; returns its path. */
async function script(dir: string, name: string, body: string): Promise<string> {
  await Deno.mkdir(dir, { recursive: true });
  const file = join(dir, name);
  await Deno.writeTextFile(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

/** A `specnaut` that records the file it ran as and the PATH it was given. */
const stub = (l: { tmp: string }, dir: string) =>
  script(dir, "specnaut", `printf '%s\\n%s\\n' "$0" "$PATH" >'${join(l.tmp, "seen")}'`);

/** A marker for every external in `dir`: running one records its name. */
async function markers(tmp: string, dir: string) {
  for (const name of EXTERNALS) await script(dir, name, `echo ${name} >>'${join(tmp, "fired")}'`);
}

/** A repository with markers inside, stubs outside and beside it, the tools, and a lock's copy. */
async function layout(tmp: string): Promise<Layout> {
  const repo = join(tmp, "repo");
  await Deno.mkdir(repo);
  await git(repo, "init", "--quiet");
  const bin = join(repo, "bin");
  await markers(tmp, bin);
  await markers(tmp, join(repo, "~", "bin"));
  const submodule = join(repo, "mod");
  const modules = join(repo, ".git", "modules", "mod");
  await Deno.mkdir(join(repo, ".git", "modules"));
  await git(repo, "init", "--quiet", `--separate-git-dir=${modules}`, submodule);
  const l: Layout = {
    tmp,
    repo,
    bin,
    submodule,
    tools: await toolsIn(tmp, ["git", "readlink", "cat", "env", "rm", "dirname", "bash"]),
    outside: await stub({ tmp }, join(tmp, "outside", "real")),
    sibling: await stub({ tmp }, join(tmp, "repo-x", "bin")),
    state: await lockCopy(tmp),
    caseBlind: await Deno.stat(join(tmp, "REPO", "bin")).then(() => true, ifMissing(false)),
  };
  await links(l);
  return l;
}

/** A per-user state folder holding the copy of session s-1's review lock: the lock is held. */
async function lockCopy(tmp: string): Promise<string> {
  const state = join(tmp, "state");
  await Deno.mkdir(join(state, "specnaut", "review-lock"), { recursive: true });
  await Deno.writeTextFile(join(state, "specnaut", "review-lock", "s-1.json"), "{}\n");
  return state;
}

/** The shells the spellings run in: bash, and zsh where it is installed. */
export type Shells = { bash: string; zsh?: string };

/** `fn` given a fresh layout under a physical temp folder, and the shells; then it is removed. */
export async function inLayout(fn: (l: Layout, shells: Shells) => Promise<void>) {
  const tmp = await Deno.realPath(await Deno.makeTempDir({ prefix: "resolve-verifier-" }));
  try {
    const which = async (s: string) => (await run("bash", ["-c", `command -v ${s}`], tmp)).stdout;
    const zsh = (await which("zsh")).trim() || undefined;
    await fn(await layout(tmp), { bash: (await which("bash")).trim(), zsh });
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

/**
 * Linked parents and folders, links across the repository's edge both ways (a folder of the tree
 * that is a link to one outside included), a chain, a dangler.
 */
async function links(l: Layout) {
  await Deno.symlink(l.repo, join(l.tmp, "alias"));
  await Deno.symlink(l.bin, join(l.tmp, "binlink"));
  await Deno.symlink(join(l.tmp, "nowhere"), join(l.tmp, "dangling"));
  await Deno.mkdir(join(l.tmp, "outside", "links"));
  await Deno.symlink(join(l.bin, "specnaut"), join(l.tmp, "outside", "links", "specnaut"));
  await Deno.mkdir(join(l.repo, "linkbin"));
  await Deno.symlink(l.outside, join(l.repo, "linkbin", "specnaut"));
  await Deno.symlink(join(l.tmp, "outside", "real"), join(l.repo, "outlink"));
  const chain = join(l.tmp, "outside", "chain");
  await Deno.mkdir(chain);
  await Deno.symlink(l.outside, join(chain, "c2"));
  await Deno.symlink("c2", join(chain, "c1"));
  await Deno.symlink("../chain/c1", join(chain, "specnaut"));
}

/** The markers that ran, removed so the next run starts with none. */
export async function fired(l: Layout): Promise<string> {
  const file = join(l.tmp, "fired");
  const text = await Deno.readTextFile(file).catch(ifMissing(""));
  await Deno.remove(file).catch(ifMissing(undefined));
  return text;
}

/** A rejection handler: `value` when the file is not there; any other failure is the test's. */
export const ifMissing = <T>(value: T) => (e: unknown): T => {
  if (e instanceof Deno.errors.NotFound) return value;
  throw e;
};
