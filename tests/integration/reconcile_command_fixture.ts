import { dirname, join } from "@std/path";
import { type InstalledLock, parseLock } from "../../src/domain/installed_lock.ts";
import { runSpecnaut } from "../helpers/run_specnaut.ts";

/**
 * The project the `reconcile <path>` command tests run against, black-box through `main`: what
 * the retired parity scenario `reconcile-path` planted (cli#795). The lock tracks four paths;
 * three exist in the project; the staging tree holds two of those, one the lock does not track,
 * and one whose project file is gone. So each refusal has exactly one reason to refuse.
 */

/** Every planted row's digest: an empty file's, as the scenario recorded it. */
export const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const TRACKED = ["a/one.md", "a/two.md", "a/unstaged.md", "a/gone.md"];

/** The lock as a past install wrote it: text, not today's serializer's output. */
const LOCK = [
  "version: 2",
  "harness: claude",
  "backlog_backend: local",
  "version_scheme: semver",
  "spec_backend: local",
  "templates_version: 0.0.1",
  "entries:",
  ...TRACKED.flatMap((rel) => [
    `  ${rel}:`,
    `    sha256: ${EMPTY_SHA}`,
    "    installed_at: '2026-01-01T00:00:00.000Z'",
    "    templates_version: 0.0.1",
  ]),
  "",
].join("\n");

export const STAGING = ".specnaut/upgrade-staging";
export const LOCK_REL = ".specnaut/installed.lock";

const FILES: Record<string, string> = {
  [LOCK_REL]: LOCK,
  "a/one.md": "local one\n",
  "a/two.md": "local two\n",
  "a/unstaged.md": "local, nothing staged\n",
  [`${STAGING}/a/one.md`]: "upstream one\n",
  [`${STAGING}/a/two.md`]: "upstream two\n",
  [`${STAGING}/c/untracked.md`]: "staged, but the lock does not track it\n",
  [`${STAGING}/a/gone.md`]: "staged, but the project file is gone\n",
};

/** A work folder holding the planted `project/`, for the length of `fn`. */
export async function withWork(fn: (work: string, project: string) => Promise<void>) {
  const work = await Deno.makeTempDir({ prefix: "specnaut-reconcile-cmd-" });
  const project = join(work, "project");
  try {
    for (const [rel, text] of Object.entries(FILES)) {
      await Deno.mkdir(dirname(join(project, rel)), { recursive: true });
      await Deno.writeTextFile(join(project, rel), text);
    }
    await fn(work, project);
  } finally {
    await Deno.remove(work, { recursive: true });
  }
}

/** `specnaut reconcile <args>` from `cwd`, as a user's shell runs it. */
export const reconcile = (cwd: string, ...args: string[]) =>
  runSpecnaut(["reconcile", ...args], { cwd });

export async function lockOf(project: string): Promise<InstalledLock> {
  return parseLock(await Deno.readTextFile(join(project, LOCK_REL)));
}
