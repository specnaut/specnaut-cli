import { fromFileUrl } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * Run the CLI from source, black-box, with the permissions `deno task test`
 * grants — what an integration test sees is what a user's shell sees. With
 * `stdin`, the text is the command's input, as a hook's payload is.
 */
export async function runSpecnaut(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; stdin?: string } = {},
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
    ...(opts.env ? { env: opts.env } : {}),
    ...(opts.stdin === undefined ? {} : { stdin: "piped" as const }),
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = opts.stdin === undefined
    ? await p.output()
    : await withInput(p.spawn(), opts.stdin);
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function withInput(child: Deno.ChildProcess, input: string): Promise<Deno.CommandOutput> {
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(input));
  await writer.close();
  return await child.output();
}
