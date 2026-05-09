import type { GitAdapter } from "../application/ports.ts";

export class DenoGit implements GitAdapter {
  async isAvailable(): Promise<boolean> {
    try {
      const p = new Deno.Command("git", {
        args: ["--version"],
        stdout: "null",
        stderr: "null",
      });
      const status = await p.output();
      return status.success;
    } catch {
      return false;
    }
  }

  async isInitialized(dir: string): Promise<boolean> {
    try {
      const stat = await Deno.lstat(`${dir}/.git`);
      return stat.isDirectory || stat.isFile;
    } catch {
      return false;
    }
  }

  async init(dir: string): Promise<void> {
    const p = new Deno.Command("git", {
      args: ["init", "--quiet"],
      cwd: dir,
      stdout: "null",
      stderr: "null",
    });
    const status = await p.output();
    if (!status.success) {
      throw new Error("git init failed");
    }
  }

  async getRemoteUrl(dir: string, remote: string): Promise<string | null> {
    try {
      const p = new Deno.Command("git", {
        args: ["remote", "get-url", remote],
        cwd: dir,
        stdout: "piped",
        stderr: "null",
      });
      const out = await p.output();
      if (!out.success) return null;
      const url = new TextDecoder().decode(out.stdout).trim();
      return url.length > 0 ? url : null;
    } catch {
      return null;
    }
  }
}
