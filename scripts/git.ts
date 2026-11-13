// git — the one way the release scripts run git: `check-release-commit.ts` and
// `check-release-history.ts` both read the repository through it.

/**
 * `git <args>`'s output, trimmed; throws with git's own message when it fails,
 * so a caller never reads a git failure as an empty answer.
 */
export async function git(...args: string[]): Promise<string> {
  const out = await new Deno.Command("git", { args, stdout: "piped", stderr: "piped" }).output();
  if (!out.success) {
    const said = new TextDecoder().decode(out.stderr).trim();
    throw new Error(`git ${args.join(" ")} failed: ${said}`);
  }
  return new TextDecoder().decode(out.stdout).trim();
}
