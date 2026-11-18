/**
 * The hardened git's flags and environment, copied from where the shell scripts keep them,
 * `templates/core/specnaut/scripts/bash/_git_untrusted.sh`; `untrusted_git_test.ts` holds the two
 * equal. `untrusted_git.ts` runs git with them, `git_branch_fetch.ts` fetches with them. Pure data.
 */

/** The defaults `_gu_git` in `_git_untrusted.sh` passes before every subcommand, in its order. */
// deno-fmt-ignore
export const UNTRUSTED_GIT_FLAGS: readonly string[] = [
  "--no-pager", "--no-optional-locks", "--literal-pathspecs",
  "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "log.showSignature=false",
  "-c", "gpg.program=/dev/null/none", "-c", "gpg.openpgp.program=/dev/null/none",
  "-c", "gpg.ssh.program=/dev/null/none", "-c", "gpg.x509.program=/dev/null/none",
  "-c", "submodule.recurse=false", "-c", "diff.submodule=short", "-c", "diff.relative=false",
  "--no-replace-objects",
];

/** Passed only to a git that knows it (2.44 or later); below it, a promisor remote is refused. */
export const LAZY_FETCH_FLAG = "--no-lazy-fetch";

/**
 * `_GU_PLAIN`: the flags every form that diffs carries. Every changed path is counted: a rename as
 * its delete and its add, and a gitlink change whatever the submodule's `ignore` setting says;
 * every changed line is shown as text, whatever makes git call its file binary.
 */
export const PLAIN_DIFF_FLAGS: readonly string[] = [
  "--no-textconv",
  "--no-ext-diff",
  "--no-color",
  "--no-renames",
  "--ignore-submodules=none",
  "--text",
];

/** What `_gu_env_run` exports, plus no system configuration (a file the repository cannot see). */
export const UNTRUSTED_GIT_ENV: Readonly<Record<string, string>> = {
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_GRAFT_FILE: "/dev/null/none",
  GIT_CONFIG_NOSYSTEM: "1",
};

/**
 * The caller's variables git may still see: where to find programs and the user's own global
 * configuration, the temp folder, the locale, and what Windows needs to start a process at all.
 */
// deno-fmt-ignore
export const ENV_ALLOWLIST: readonly string[] = [
  "PATH", "HOME", "XDG_CONFIG_HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE",
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP",
];
