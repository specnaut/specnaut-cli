import type {
  SubprocessOptions,
  SubprocessResult,
  SubprocessRunner,
} from "../application/ports.ts";

export class DenoSubprocessRunner implements SubprocessRunner {
  async run(cmd: string, args: string[], opts?: SubprocessOptions): Promise<SubprocessResult> {
    const p = new Deno.Command(cmd, {
      args,
      cwd: opts?.cwd,
      env: opts?.env,
      stdin: opts?.stdin ? "piped" : "null",
      stdout: "piped",
      stderr: "piped",
    });

    const child = p.spawn();
    if (opts?.stdin) {
      const writer = child.stdin.getWriter();
      await writer.write(new TextEncoder().encode(opts.stdin));
      await writer.close();
    }
    const { code, stdout, stderr } = await child.output();
    return {
      code,
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
    };
  }
}
