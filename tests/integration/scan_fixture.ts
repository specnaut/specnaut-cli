// Shared fixture for the `specnaut scan` tests: a throwaway git repository built file by file, and
// the CLI run on it from source, black-box, with the permissions `deno task test` grants.

import { dirname, join } from "@std/path";
import { runSpecnaut } from "../helpers/run_specnaut.ts";

export type Result = { code: number; stdout: string; stderr: string };

/** Planting a link needs a privilege the Windows runner is not known to grant. */
export const POSIX = Deno.build.os !== "windows";

/** No global or system config of the machine running the tests reaches the fixture's git. */
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: Deno.build.os === "windows" ? "NUL" : "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

/** git in `cwd`, with no signing in the way. The output, or a throw. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args: ["-c", "commit.gpgsign=false", ...args],
    cwd,
    env: GIT_ENV,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  if (!out.success) throw new Error(`git ${args.join(" ")}: ${d.decode(out.stderr)}`);
  return d.decode(out.stdout);
}

/** git in `cwd` reading `input` on its stdin, for a record no argument can carry. A throw unless it succeeds. */
export async function gitWithInput(cwd: string, input: Uint8Array, ...args: string[]) {
  const child = new Deno.Command("git", {
    args,
    cwd,
    env: GIT_ENV,
    stdin: "piped",
    stderr: "piped",
  })
    .spawn();
  const writer = child.stdin.getWriter();
  await writer.write(input);
  await writer.close();
  const out = await child.output();
  if (!out.success) {
    throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr)}`);
  }
}

/** `n` lines, each ending in a newline. */
export const lines = (n: number, text = "x") => `${text}\n`.repeat(n);

const made: string[] = [];
globalThis.addEventListener("unload", () => {
  for (const dir of made) Deno.removeSync(dir, { recursive: true });
});

/** A repository holding `files`, all added and committed; removed when the test module ends. */
export async function repo(files: Record<string, string | Uint8Array>): Promise<string> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "scan-" }));
  made.push(dir);
  await git(dir, "init", "-q");
  await write(dir, files);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "--allow-empty", "-m", "fixture");
  return dir;
}

export async function write(dir: string, files: Record<string, string | Uint8Array>) {
  for (const [path, content] of Object.entries(files)) {
    await Deno.mkdir(dirname(join(dir, path)), { recursive: true });
    if (typeof content === "string") await Deno.writeTextFile(join(dir, path), content);
    else await Deno.writeFile(join(dir, path), content);
  }
}

/** `specnaut scan` in `cwd`. */
export function scan(cwd: string, ...args: string[]): Promise<Result> {
  return runSpecnaut(["scan", ...args], { cwd });
}

/** `specnaut scan --format json` in `cwd`, parsed; the result too, for its exit code and stderr. */
export async function scanJson(cwd: string, ...args: string[]) {
  const result = await scan(cwd, "--format", "json", ...args);
  if (result.stdout.trim() === "") {
    throw new Error(`no JSON (exit ${result.code}): ${result.stderr}`);
  }
  // deno-lint-ignore no-explicit-any
  return { result, json: JSON.parse(result.stdout) as any };
}

/** The four dispositions, which must add up to what git tracks. */
// deno-lint-ignore no-explicit-any
export function dispositions(json: any) {
  const t = json.totals;
  return { tracked: t.tracked, sum: t.measured + t.exempt + t.skipped + t.missing };
}

/**
 * Replaces the index with one listing `names`, each pointing at `blob`, written byte by byte (index
 * format v2): git's own commands refuse a name with a `..`, `.` or empty segment, but `ls-files`
 * lists whatever an index holds, and a repository can ship any index it likes.
 */
export async function writeRawIndex(dir: string, blob: string, names: string[]): Promise<void> {
  const enc = new TextEncoder();
  const entries = [...names].sort().map((name) => {
    const n = enc.encode(name);
    const entry = new Uint8Array(Math.ceil((62 + n.length + 1) / 8) * 8);
    const view = new DataView(entry.buffer);
    view.setUint32(24, 0o100644);
    entry.set(blob.match(/../g)!.map((h) => parseInt(h, 16)), 40);
    view.setUint16(60, n.length);
    entry.set(n, 62);
    return entry;
  });
  const header = new Uint8Array([...enc.encode("DIRC"), 0, 0, 0, 2, 0, 0, 0, names.length]);
  const body = new Uint8Array(await new Blob([header, ...entries]).arrayBuffer());
  const sum = new Uint8Array(await crypto.subtle.digest("SHA-1", body));
  await Deno.writeFile(join(dir, ".git", "index"), new Uint8Array([...body, ...sum]));
}
