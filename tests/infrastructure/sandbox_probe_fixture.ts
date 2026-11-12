import type { SubprocessOptions, SubprocessResult } from "../../src/application/ports.ts";
import type { ImageSource } from "../../src/domain/sandbox_image.ts";
import { HostBackendProber } from "../../src/infrastructure/sandbox_probe.ts";

/** What the probe tests share: a prober whose tools answer from a table, and the calls it made. */

export const IMAGE: ImageSource = { kind: "pinned", ref: `acme/dev@sha256:${"d".repeat(64)}` };
const NOT_FOUND: SubprocessResult = { code: 127, stdout: "", stderr: "not found" };

type Call = { cmd: string; args: string[] };

/** A prober on `os` whose tools answer `answers` by `<cmd> <first arg>`, else by `<cmd>`. */
export function prober(os: string, answers: Record<string, SubprocessResult>) {
  const calls: Call[] = [];
  const run = {
    run(cmd: string, args: string[], _opts?: SubprocessOptions): Promise<SubprocessResult> {
      calls.push({ cmd, args });
      const key = `${cmd} ${args[0]}`;
      return Promise.resolve(answers[key] ?? answers[cmd] ?? NOT_FOUND);
    },
  };
  return {
    calls,
    prober: new HostBackendProber(run, { os, arch: "x86_64" }, () => Promise.resolve(IMAGE)),
  };
}

export const ok = (stdout = ""): SubprocessResult => ({ code: 0, stdout, stderr: "" });
