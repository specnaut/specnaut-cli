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
      // Synthesise POSIX-style exit codes for the failure modes that surface
      // as exceptions on `Deno.Command.spawn()`, so probes can render a clean
      // fail/warn row instead of crashing with a stack trace.
      if (err instanceof Deno.errors.NotFound) {
        // 127 — binary missing from PATH.
        return { code: 127, stdout: "", stderr: `${cmd}: command not found` };
      }
      if (
        err instanceof Deno.errors.PermissionDenied ||
        err instanceof Deno.errors.NotCapable
      ) {
        // 126 — binary exists but cannot be executed (chmod 000, --allow-run
        // denial, SELinux deny, etc.).
        return { code: 126, stdout: "", stderr: `${cmd}: permission denied` };
      }
      throw err;
    }
  }
}
