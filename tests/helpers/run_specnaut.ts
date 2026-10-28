import { fromFileUrl } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * Run the CLI from source, black-box, with the permissions `deno task test`
 * grants — what an integration test sees is what a user's shell sees.
 */
export async function runSpecnaut(
  args: string[],
  opts: { cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      MAIN,
      ...args,
    ],
    cwd: opts.cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await p.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}
