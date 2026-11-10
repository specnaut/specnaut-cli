import { assertEquals } from "@std/assert";
import { bashArgv } from "./bash_argv.ts";

/**
 * Every shape an argument of the bash-script tests takes reaches the script as
 * one argument, unchanged. On Windows a direct `bash` call does not deliver the
 * first three whole: Git Bash re-splits the command line at `\r` and `\n`, and
 * reads no `\"`.
 */
Deno.test("bashArgv hands bash each argument whole: CR, LF, a quote, an empty one, a space", async () => {
  const given = ["a\rb", "c\nd", 'e"f', "", "g h", "-n"];
  const { args, env } = bashArgv([
    "-c",
    'printf "<%s>" "$@"; printf "|%s" "${SPECNAUT_ARGC-}"',
    "_",
    ...given,
  ]);
  const out = await new Deno.Command("bash", { args, env, stdout: "piped", stderr: "piped" })
    .output();
  const d = new TextDecoder();
  assertEquals(out.code, 0, d.decode(out.stderr));
  // `|` and nothing after it: the driver's own variables do not reach the script.
  assertEquals(d.decode(out.stdout), given.map((a) => `<${a}>`).join("") + "|");
});
