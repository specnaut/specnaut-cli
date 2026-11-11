// Shared fixture for `specnaut verify-scripts`: a project on `main`, pushed to a bare origin whose
// HEAD names it, with the lock and the bundled helper scripts committed, and a feature branch
// checked out. The CLI runs from source, black-box.

import { dirname, join } from "@std/path";
import { bundleForLock } from "../../src/application/lock_bundle.ts";
import { findHarness } from "../../src/cli/harnesses.ts";
import { parseLock } from "../../src/domain/installed_lock.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { runSpecnaut } from "../helpers/run_specnaut.ts";
import { DENO_DIR } from "./spawn_env.ts";

export const LOCK =
  "version: 2\nharness: claude\nbacklog_backend: local\nversion_scheme: semver\n" +
  "spec_backend: local\ntemplates_version: 0.0.1\nentries: {}\n";
export const GIT_READ = ".specnaut/scripts/bash/git-read.sh";
export const RATCHET = ".specnaut/scripts/bash/size-ratchet.sh";

/** The bytes this binary would write at `path` for the fixture's lock. */
export function bundled(path: string): string {
  return bundleForLock(CORE_BUNDLE, parseLock(LOCK), findHarness)![path].content;
}

/** No global or system configuration, and a fixed identity: the fixture is all git reads. */
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

/**
 * The parent's environment minus every `GIT_*` variable (a hook's `GIT_DIR` or `GIT_INDEX_FILE`
 * would aim the fixture at the outer repository), read at each call, then {@link GIT_ENV}.
 */
function gitEnv(): Record<string, string> {
  const inherited = Object.entries(Deno.env.toObject()).filter(([k]) => !/^GIT_/i.test(k));
  return { ...Object.fromEntries(inherited), ...GIT_ENV };
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args: ["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args],
    cwd,
    clearEnv: true,
    env: gitEnv(),
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  if (!out.success) throw new Error(`git ${args.join(" ")}: ${d.decode(out.stderr)}`);
  return d.decode(out.stdout);
}

export async function write(dir: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await Deno.mkdir(dirname(join(dir, path)), { recursive: true });
    await Deno.writeTextFile(join(dir, path), content);
  }
}

/** Commits everything in `dir` with `message`. */
export async function commitAll(dir: string, message: string) {
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", message);
}

/**
 * `{ root, project }`: `project` is `root`, or a folder under it when `prefix` is given. The base
 * holds `files` (default: the lock and the bundled git-read.sh); `feature` is checked out.
 */
export async function fixture(
  opts: { files?: Record<string, string>; prefix?: string } = {},
): Promise<{ root: string; project: string; origin: string }> {
  const top = await Deno.realPath(await Deno.makeTempDir({ prefix: "verify-scripts-" }));
  const origin = join(top, "origin.git");
  const root = join(top, "repo");
  await Deno.mkdir(root);
  await git(top, "init", "-q", "--bare", origin);
  await git(root, "init", "-q", "-b", "main");
  await git(root, "remote", "add", "origin", origin);
  const project = opts.prefix ? join(root, opts.prefix) : root;
  const files = opts.files ?? { ".specnaut/installed.lock": LOCK, [GIT_READ]: bundled(GIT_READ) };
  await write(project, files);
  await commitAll(root, "base");
  await git(root, "push", "-q", "origin", "main");
  await git(root, "remote", "set-head", "origin", "main");
  await git(root, "checkout", "-q", "-b", "feature");
  return { root, project, origin };
}

/** Moves origin's main forward by one commit writing `files`, as another branch landing would. */
export async function advanceBase(root: string, files: Record<string, string>) {
  await git(root, "checkout", "-q", "main");
  await write(root, files);
  await commitAll(root, "base moves");
  await git(root, "push", "-q", "origin", "main");
  await git(root, "checkout", "-q", "feature");
}

export type Verified = {
  code: number;
  lines: string[];
  field: (key: string) => string | undefined;
  untrusted: string[];
  stderr: string;
};

let home: string | undefined;

/**
 * An empty HOME for the CLI, made once: the git it runs reads the user's global configuration
 * (`init.defaultBranch` names the base when origin has no HEAD), which is the developer's here.
 */
function cliHome(): Record<string, string> {
  home ??= Deno.makeTempDirSync({ prefix: "verify-scripts-cli-home-" });
  return { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"), DENO_DIR };
}

/** `specnaut verify-scripts` in `cwd`, its stdout split into fields. */
export async function verify(cwd: string): Promise<Verified> {
  const r = await runSpecnaut(["verify-scripts"], { cwd, env: cliHome() });
  const lines = r.stdout.trimEnd().split("\n");
  const field = (key: string) => lines.find((l) => l.startsWith(`${key} `))?.slice(key.length + 1);
  const untrusted = lines.filter((l) => l.startsWith("UNTRUSTED ")).map((l) => l.slice(10));
  return { code: r.code, lines, field, untrusted, stderr: r.stderr };
}
