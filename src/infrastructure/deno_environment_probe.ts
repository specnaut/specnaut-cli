import type { EnvironmentProbe, SubprocessResult, SubprocessRunner } from "../application/ports.ts";
import type { CheckOutcome } from "../domain/check_result.ts";

export class DenoEnvironmentProbe implements EnvironmentProbe {
  constructor(private readonly runner: SubprocessRunner) {}

  async probeGit(): Promise<CheckOutcome> {
    const res = await this.runner.run("git", ["--version"]);
    if (res.code !== 0) {
      return { name: "git", status: "fail", message: missing(res) };
    }
    const version = extractVersion(res.stdout) ?? "unknown";
    return { name: "git", status: "pass", message: `git version ${version}` };
  }

  async probeGh(): Promise<CheckOutcome> {
    const version = await this.runner.run("gh", ["--version"]);
    if (version.code !== 0) {
      return { name: "gh", status: "fail", message: missing(version) };
    }
    const v = extractVersion(version.stdout) ?? "unknown";

    const auth = await this.runner.run("gh", ["auth", "status"]);
    if (auth.code !== 0) {
      return {
        name: "gh",
        status: "warn",
        message: `gh version ${v} (not authenticated — run 'gh auth login')`,
      };
    }
    // gh 2.7+ writes `gh auth status` output to stdout; older versions
    // wrote it to stderr. Search both so the probe works across versions.
    const combined = `${auth.stdout}\n${auth.stderr}`;
    const loginMatch = combined.match(/account\s+(\S+)/);
    const login = loginMatch ? loginMatch[1] : "unknown";
    return {
      name: "gh",
      status: "pass",
      message: `gh version ${v} (authenticated as ${login})`,
    };
  }

  async probeDeno(): Promise<CheckOutcome> {
    const res = await this.runner.run("deno", ["--version"]);
    if (res.code !== 0) {
      return {
        name: "deno",
        status: "warn",
        message: `${missing(res, "deno not found in PATH")} (optional — only needed for ` +
          "Specnaut development)",
      };
    }
    const v = extractVersion(res.stdout) ?? "unknown";
    return { name: "deno", status: "pass", message: `deno ${v}` };
  }
}

/**
 * Why a program did not answer. Not found (127), the runner's reason, which names the PATH entry
 * left out for being in the project's tree: the program the user expects may sit on it.
 */
function missing(res: SubprocessResult, fallback = "not found in PATH"): string {
  return res.code === 127 && res.stderr !== "" ? res.stderr : fallback;
}

function extractVersion(output: string): string | null {
  const m = output.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
  return m ? m[1] : null;
}
