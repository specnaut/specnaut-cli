import { fromFileUrl } from "@std/path";

const DRIVER = fromFileUrl(new URL("./argv_from_env.sh", import.meta.url));

/**
 * The argv and environment that start `bash <args>` with every argument intact,
 * on Windows too.
 *
 * A Windows process receives its arguments as one command line. Deno quotes an
 * argument only when it holds a space or a tab, and escapes a quote as `\"`, the
 * C runtime's way; Git Bash's runtime re-splits that line its own way: it reads
 * `\r` and `\n` as separators and does not take `\"` for a quote. So `HEAD\r`
 * arrived as `HEAD`, `foo\nbar` as two arguments, and a `-c` script lost its
 * quotes. The environment is not re-split: each argument travels in a variable,
 * and a fixed script rebuilds argv inside bash before anything else runs. The
 * command line then carries only that script's path.
 *
 * Used on every OS, so the path Windows takes is the one every run exercises.
 */
export function bashArgv(args: string[]): { args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = { SPECNAUT_ARGC: String(args.length) };
  args.forEach((a, i) => env[`SPECNAUT_ARGV_${i}`] = a);
  return { args: [DRIVER], env };
}
