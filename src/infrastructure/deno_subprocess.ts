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

    try {
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
    } catch (err) {
      // Binary missing from PATH: return a synthetic 127 instead of throwing,
      // so probes (probeGit/probeGh/probeDeno) can render a clean check row.
      if (err instanceof Deno.errors.NotFound) {
        return { code: 127, stdout: "", stderr: `${cmd}: command not found` };
      }
      throw err;
    }
  }
}
