import { git, type Sandbox, sandbox } from "./git_sandbox.ts";
import { shim } from "./git_shim.ts";

/**
 * cli#799 — the merge phase pushes with hooks off, so git-lfs's pre-push upload never runs and
 * `lfs-push.sh` pushes the objects itself. These build what its tests share.
 */

/**
 * `.gitattributes` marking `pattern` for git-lfs, on origin's base: a branch that adds it changes
 * an instruction file, which the landing does not take without a yes.
 */
export async function trackOnBase(sb: Sandbox, pattern: string): Promise<void> {
  await sb.commit(
    ".gitattributes",
    `${pattern} filter=lfs diff=lfs merge=lfs -text\n`,
    "chore: lfs",
  );
  await git(sb.work, "push", "--quiet", "origin", "main");
}

/**
 * A feature branch adding `a.bin`, which the base marks for git-lfs. No lfs filter is configured
 * (the sandbox's git config is isolated), so the file is committed as it is: the scripts read the
 * attribute, never the content.
 */
export async function lfsBranch(): Promise<Sandbox> {
  const sb = await sandbox();
  await trackOnBase(sb, "*.bin");
  await git(sb.work, "switch", "--quiet", "-c", "feature");
  await sb.commit("a.bin", "blob\n", "feat(7): a blob");
  return sb;
}

/**
 * A `git` that logs every call to `log`, one line of its arguments past the `-c` pairs, and fakes
 * `git lfs`: `version` prints `version` when it is not empty, and every other lfs call (a version
 * left empty included) runs `rest`, which exits. Every other subcommand runs the real git, after
 * `first`, a bash line that may exit instead.
 */
export function lfsShim(log: string, version: string, rest = "exit 0", first = ""): string {
  return shim(`printf '%s\\n' "$*" >>'${log}'
${first}
if [ "$1" = lfs ]; then
  [ "$2" = version ] && [ -n '${version}' ] && { echo '${version}'; exit 0; }
  ${rest}
fi`);
}

/** The lines of the shim's log, empty when nothing was logged. */
export async function calls(log: string): Promise<string[]> {
  const text = await Deno.readTextFile(log).catch((e) => {
    if (e instanceof Deno.errors.NotFound) return "";
    throw e;
  });
  return text.split("\n").filter(Boolean);
}
