import { DELIMITER, fromFileUrl, join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";

/**
 * A throwaway clone with a bare `origin` whose HEAD is `main`, and the merge
 * scripts installed at `.specnaut/scripts/bash/` — the layout `base-branch.sh`
 * and the scripts resolve against (spec 042). Every command runs through
 * argv, never a shell string.
 */

const BASH_DIR = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/", import.meta.url),
);
export const SCRIPTS = [
  "base-branch.sh",
  "epic-status.sh",
  "fold-fixups.sh",
  "land-feature.sh",
  "remove-spec.sh",
];

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
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
    env: {
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

export interface Sandbox {
  root: string;
  work: string;
  remote: string;
  /** Runs an installed script, as `bash .specnaut/scripts/bash/<name>` from the clone. */
  script(name: string, ...args: string[]): Promise<Run>;
  /** The same, with `git` on PATH replaced by a bash shim (not on Windows). */
  scriptWithGit(shim: string, name: string, ...args: string[]): Promise<Run>;
  commit(file: string, content: string, ...message: string[]): Promise<string>;
  /** origin refuses every push until `<root>/allow` exists — a transient rejection. */
  refusePushes(): Promise<void>;
  cleanup(): Promise<void>;
}

/** A clone of an `origin` holding one commit on `main`, with origin/HEAD set. */
export async function sandbox(): Promise<Sandbox> {
  const root = await Deno.makeTempDir({ prefix: "specnaut-merge-scripts-" });
  const remote = join(root, "origin.git");
  const work = join(root, "work");
  await git(root, "init", "--quiet", "--bare", "-b", "main", remote);
  await git(root, "clone", "--quiet", remote, work);
  await git(work, "config", "user.name", "t");
  await git(work, "config", "user.email", "t@example.test");
  await git(work, "config", "commit.gpgsign", "false");
  await Deno.writeTextFile(join(work, "README.md"), "base\n");
  await git(work, "add", "README.md");
  await git(work, "commit", "--quiet", "-m", "base");
  await git(work, "push", "--quiet", "origin", "main");
  await git(work, "remote", "set-head", "origin", "main");
  const dest = join(work, ".specnaut/scripts/bash");
  await Deno.mkdir(dest, { recursive: true });
  for (const s of SCRIPTS) await Deno.copyFile(join(BASH_DIR, s), join(dest, s));
  // The installed scripts are the project's tooling, committed like any other file.
  await git(work, "add", ".specnaut");
  await git(work, "commit", "--quiet", "-m", "chore: install the scripts");
  await git(work, "push", "--quiet", "origin", "main");
  return {
    root,
    work,
    remote,
    script: (name, ...args) =>
      run("bash", [bashPath(join(".specnaut/scripts/bash", name)), ...args], work),
    async scriptWithGit(shim, name, ...args) {
      // The shim stands in for git; `$REAL_GIT` is the one it wraps.
      const real = (await run("bash", ["-c", "command -v git"], work)).stdout.trim();
      const bin = join(root, "bin");
      await Deno.mkdir(bin, { recursive: true });
      await Deno.writeTextFile(
        join(bin, "git"),
        `#!/usr/bin/env bash\nREAL_GIT='${real}'\n${shim}\n`,
      );
      await Deno.chmod(join(bin, "git"), 0o755);
      return run("bash", [bashPath(join(".specnaut/scripts/bash", name)), ...args], work, {
        PATH: `${bin}${DELIMITER}${Deno.env.get("PATH")}`,
      });
    },
    async commit(file, content, ...message) {
      await Deno.mkdir(join(work, file, ".."), { recursive: true });
      await Deno.writeTextFile(join(work, file), content);
      await git(work, "add", file);
      await git(work, "commit", "--quiet", ...message.flatMap((m) => ["-m", m]));
      return await git(work, "rev-parse", "HEAD");
    },
    async refusePushes() {
      const hook = join(remote, "hooks/pre-receive");
      await Deno.writeTextFile(
        hook,
        `#!/bin/sh\n[ -f "${bashPath(root)}/allow" ] && exit 0\necho refused >&2\nexit 1\n`,
      );
      // Windows has no mode bits: Git for Windows runs a hook by its `#!` line.
      if (Deno.build.os !== "windows") await Deno.chmod(hook, 0o755);
    },
    cleanup: () => Deno.remove(root, { recursive: true }),
  };
}
