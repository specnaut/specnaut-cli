import { basename, DELIMITER, join } from "@std/path";
import type { Sandbox } from "./hook_sandbox.ts";

/**
 * The PATH a hook test runs its child under (spec 036): split on the
 * platform's delimiter, without jq (FR-015), or with a jq that writes CRLF as
 * its Windows build does. Beside hook_sandbox.ts, which owns the sandbox.
 */

const WINDOWS = Deno.build.os === "windows";

/** PATH split on the platform's delimiter: `;` on Windows, where `C:\x` holds a `:`. */
export function pathEntries(path = Deno.env.get("PATH") ?? ""): string[] {
  return path.split(DELIMITER).filter((e) => e !== "");
}

const TOOLS = [
  "bash",
  "git",
  "cat",
  "tr",
  "grep",
  "awk",
  "sed",
  "mktemp",
  "mv",
  "rm",
  "mkdir",
  "chmod",
  "dirname",
  "head",
  "shasum",
  "sha256sum",
  "env",
  "perl",
];

/** `tool` in `dir` (`tool.exe` too, on Windows): its path, or null. */
async function findIn(dir: string, tool: string): Promise<string | null> {
  for (const name of WINDOWS ? [tool, `${tool}.exe`] : [tool]) {
    try {
      await Deno.stat(join(dir, name));
      return join(dir, name);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
  return null;
}

/**
 * A PATH holding every tool the hooks use except `jq` — the "jq is missing"
 * case (FR-015). Stripping PATH outright would test that bash is missing. Each
 * entry holding a jq is dropped, and a tool that lived only beside it (on
 * Linux, /usr/bin holds both) is linked into a shim dir. On Windows jq sits
 * apart from Git's tools, so nothing is linked — a symlinked MSYS binary would
 * look for its DLLs beside the link.
 */
export async function pathWithoutJq(sb: Sandbox): Promise<string> {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const dir of pathEntries()) ((await findIn(dir, "jq")) ? dropped : kept).push(dir);
  const bin = join(sb.dir, "bin-nojq");
  await Deno.mkdir(bin, { recursive: true });
  for (const tool of TOOLS) {
    if ((await Promise.all(kept.map((d) => findIn(d, tool)))).some((p) => p !== null)) continue;
    for (const dir of dropped) {
      const found = await findIn(dir, tool);
      if (found === null) continue;
      await Deno.symlink(found, join(bin, basename(found))).catch((e) => {
        if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
      });
      break;
    }
  }
  return [bin, ...kept].join(DELIMITER);
}

/**
 * A PATH whose `jq` writes CRLF, as a native Windows jq.exe does (stdout in
 * text mode: every `\n` written as `\r\n`, and nothing else touched). On
 * Windows that is the real one, unwrapped — wrapping it would double each
 * `\r`; elsewhere, the real one behind `s/\n/\r\n/`, which leaves an
 * unterminated last line (`jq -j`) alone, as jq.exe does.
 */
export async function pathWithCrlfJq(sb: Sandbox): Promise<string> {
  if (WINDOWS) return sb.env.PATH;
  const real = await new Deno.Command("bash", {
    args: ["-c", "command -v jq"],
    env: sb.env,
    clearEnv: true,
  }).output();
  if (!real.success) throw new Error(`no jq to wrap: ${new TextDecoder().decode(real.stderr)}`);
  const bin = join(sb.dir, "bin-crlf");
  await Deno.mkdir(bin, { recursive: true });
  await Deno.writeTextFile(
    join(bin, "jq"),
    `#!/usr/bin/env bash\nset -o pipefail\n"${
      new TextDecoder().decode(real.stdout).trim()
    }" "$@" | perl -pe 's/\\n/\\r\\n/'\n`,
  );
  await Deno.chmod(join(bin, "jq"), 0o755);
  return [bin, ...pathEntries(sb.env.PATH)].join(DELIMITER);
}
