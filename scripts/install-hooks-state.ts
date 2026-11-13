// What sits at the pre-commit hook target, read from the filesystem: whether the
// installer may replace it, and whether what it installed can actually run.

import { SHIM_MARKER, shimContent } from "./install-hooks-shim.ts";

async function lstatOrNull(path: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.lstat(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

/**
 * Windows has no executable bit. `Deno.chmod` is a no-op there and `mode` comes
 * back non-null with no `0o111`, so a POSIX-only test declares a perfectly good
 * install broken — which is this ticket's own defect pointed the other way: not
 * a false `✓`, a false `✗`. Permission to run is an ACL question on Windows and
 * not one this script can answer from `stat`, so it does not pretend to.
 */
function isExecutable(info: Deno.FileInfo): boolean {
  if (Deno.build.os === "windows") return true;
  return info.mode === null || (info.mode & 0o111) !== 0;
}

/** An error that says the path leads nowhere, as opposed to one that says it may not be read. */
function isAbsence(e: unknown): boolean {
  return e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotADirectory;
}

/**
 * Whether `path` reaches a file, following links. Only absence is a "no": a link
 * answered "no" is deleted as dangling, so a `stat` refused for another reason
 * (permission, a loop) is thrown, never read as a link pointing at nothing.
 */
async function resolves(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (isAbsence(e)) return false;
    throw e;
  }
}

/** The text of the file at `path`, or "" when it is gone; any other failure is thrown. */
async function textOrEmpty(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    if (isAbsence(e)) return "";
    throw e;
  }
}

/** What is sitting at the hook target, and whether we may replace it. */
export type HookState =
  | { kind: "absent" }
  | { kind: "ours-shim"; current: boolean }
  | { kind: "legacy-symlink"; link: string; dangling: boolean }
  | { kind: "foreign"; detail: string };

/**
 * Classify the hook target.
 *
 * The load-bearing case is `legacy-symlink` with `dangling: true`. The old code
 * read the link, saw text that no longer matched its own SOURCE, and fell
 * through to "exists and is not our symlink" — treating a link that points at
 * nothing exactly like a hand-written hook that must not be clobbered. A
 * dangling link can only ever be stale: nothing useful points at a file that
 * does not exist.
 */
export async function classifyHook(target: string, source: string): Promise<HookState> {
  const info = await lstatOrNull(target);
  if (info === null) return { kind: "absent" };
  if (info.isSymlink) return await classifySymlink(target, source);

  const body = await textOrEmpty(target);
  if (body.includes(SHIM_MARKER)) {
    // Content, not just the marker. A shim written by an older version is
    // ours AND wrong, and a check that stops at the marker would report
    // "already installed" over it forever — the same shape as refusing to
    // repair a link this script had itself installed.
    return { kind: "ours-shim", current: body === shimContent() };
  }
  return { kind: "foreign", detail: "a regular file this script did not write" };
}

/** A link at the target: stale when it dangles or names `source`, someone else's otherwise. */
async function classifySymlink(target: string, source: string): Promise<HookState> {
  const link = await Deno.readLink(target);
  const dangling = !(await resolves(target));
  if (dangling) return { kind: "legacy-symlink", link, dangling: true };
  if (link === source) return { kind: "legacy-symlink", link, dangling: false };
  return { kind: "foreign", detail: `a symlink to ${link}` };
}

/**
 * What stops the shim at `target` from running the hook at `source`; none when it can.
 *
 * Report the ACTUAL state, not the fact that a file was just written. An
 * installed-but-unrunnable hook is the exact condition #591 is about, and a
 * `✓` over it would be the installer telling the same lie in a new shape.
 */
export async function installProblems(target: string, source: string): Promise<string[]> {
  const problems: string[] = [];
  const installed = await lstatOrNull(target);
  if (installed === null) problems.push(`${target} is not there after writing it`);
  else if (!isExecutable(installed)) problems.push(`${target} is not executable`);
  if (!(await resolves(source))) {
    problems.push(`the hook it resolves to is missing: ${source}`);
  } else {
    const hook = await lstatOrNull(source);
    if (hook && !isExecutable(hook)) {
      problems.push(`the hook it resolves to is not executable: ${source}`);
    }
  }
  return problems;
}
