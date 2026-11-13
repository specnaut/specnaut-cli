/**
 * The body of a `scriptWithGit` shim (`git_sandbox.ts`) that tests git's subcommand and its
 * arguments as `$1`, `$2`…: the `-c` pairs a script puts first (`land-feature.sh` turns hooks off
 * that way) are skipped for the test, and passed on to the real git with everything else.
 */
export const shim = (test: string): string =>
  `all=("$@"); while [ "\${1:-}" = -c ]; do shift 2; done\n${test}\nexec "$REAL_GIT" "\${all[@]}"`;
