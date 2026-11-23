import { DELIMITER, fromFileUrl, join } from "@std/path";
import { hermetic, run } from "./git_sandbox.ts";
import { ifMissing, type Layout, type Shells } from "./resolve_verifier_layout.ts";

/**
 * The three spellings of the rule that judges the PATH and resolves `specnaut` before anything
 * runs: the resolve block of `phases/script-gate.md` (run by bash, and by zsh where it is
 * installed), `_verifier.sh` as `land-feature.sh` sources it, and `_clean-path.sh`, which the three
 * Claude Code hooks and their launcher source. They cannot share code, so one table of PATHs runs
 * every one of them, in the layout of resolve_verifier_layout.ts.
 */

const TEMPLATES = new URL("../../templates/", import.meta.url);
const at = (path: string) => fromFileUrl(new URL(path, TEMPLATES));
const BASH_DIR = at("core/specnaut/scripts/bash/");
export const HOOKS = at("harness-specific/claude/hooks/");

/** The bash block after the resolve anchor in the gate doc, as written. */
export function docBlock(): string {
  const doc = Deno.readTextFileSync(at("core/skills/task/phases/script-gate.md"));
  const after = doc.split("<!-- script-gate: resolve-verifier -->")[1];
  const m = /^\s*```bash\n([\s\S]*?)\n```/.exec(after ?? "");
  if (!m) throw new Error("script-gate.md lost its resolve block");
  return m[1];
}

/** `_verifier.sh` as land-feature.sh runs it: its shell options and `_hooks_off.sh` first. */
const LAND = `set -Eeuo pipefail
. '${join(BASH_DIR, "_hooks_off.sh")}' land-feature
. '${join(BASH_DIR, "_verifier.sh")}'
refuse_unsafe_path landed
resolve_specnaut`;

/**
 * A stub's answer: the file that ran and the PATH it was given; or a refusal and the exit it came
 * with, a refusal that lets the call run being none; or only an exit.
 */
export type Answer =
  | { resolved: string; path?: string }
  | { refused: string; entry?: string; exit: number }
  | { exit: number };

/** The refusal a run printed, its PATH entry named apart, with the run's exit `code`. */
function refusal(text: string, code: number): Answer | undefined {
  const m = /VERIFIER REFUSED: (?:PATH entry '(.*)'|\S+) (.+?)(?: - .*)?$/m.exec(text);
  if (!m) return undefined;
  return m[1] === undefined
    ? { refused: m[2], exit: code }
    : { refused: m[2], entry: m[1], exit: code };
}

/** What a stub recorded, removed so the next run starts with none. */
async function seen(l: Layout): Promise<Answer | undefined> {
  const file = join(l.tmp, "seen");
  const text = await Deno.readTextFile(file).catch(ifMissing(undefined));
  if (text === undefined) return undefined;
  await Deno.remove(file);
  const [ran, path] = text.split("\n");
  return { resolved: ran, path };
}

/**
 * One run of a spelling: the PATH, where it runs from, and the shells that run it; the hooks'
 * project folder is the repository's top unless `project` names another.
 */
export type Run = { entries: string[]; cwd: string; project?: string } & Shells;

/** A doc block or `_verifier.sh` run: what `sn` was set to, else the refusal it printed. */
export async function resolver(
  shell: string,
  flags: string[],
  code: string,
  r: Run,
): Promise<Answer> {
  const out = await run(shell, [...flags, `${code}\nprintf 'SN %s\\n' "$sn"`], r.cwd, path(r));
  const sn = /^SN (.+)$/m.exec(out.stdout)?.[1];
  if (sn) return { resolved: sn };
  return refusal(`${out.stdout}${out.stderr}`, out.code) ?? { exit: out.code };
}

const path = (r: Run) => ({ PATH: r.entries.join(DELIMITER) });

/**
 * A tool call of session s-1, whose lock is held; a shell command that starts a review, which runs
 * on the session's own PATH; one that names a review and starts none.
 */
export const CALL = '{"session_id":"s-1","tool_name":"Bash"}';
export const START = '{"tool_input":{"command":"specnaut review start 1"}}';
const MENTION = '{"tool_input":{"command":"specnaut review status"}}';

/** The answer of each spelling, in one shell's run each; `zsh` only where it is installed. */
export async function answers(l: Layout, r: Run): Promise<Record<string, Answer>> {
  const block = docBlock();
  const all: Record<string, Answer> = {
    doc: await resolver(r.bash, ["-c"], block, r),
    land: await resolver(r.bash, ["-c"], LAND, r),
    landScript: await landScript(r),
    lock: await hook(l, r, "review-lock.sh", CALL),
    launch: await launched(l, r, "review-lock.sh", CALL),
    gate: await hook(l, r, "review-gate.sh", START),
    mention: await hook(l, r, "review-gate.sh", MENTION),
    record: await hook(l, r, "record-checkout.sh", ""),
  };
  if (r.zsh) all.zsh = await resolver(r.zsh, ["-f", "-c"], block, r);
  return all;
}

/** land-feature.sh itself, as far as its first refusal. */
async function landScript(r: Run): Promise<Answer> {
  const out = await run(r.bash, [join(BASH_DIR, "land-feature.sh")], r.cwd, path(r));
  return refusal(out.stderr, out.code) ?? { exit: out.code };
}

/** A hook run by bash itself, `input` on stdin: what the stub saw, a refusal, or the exit. */
export function hook(l: Layout, r: Run, name: string, input: string): Promise<Answer> {
  return fire(l, r, [r.bash, join(HOOKS, name)], input);
}

/**
 * A hook as settings.json registers it: `sh` (`/bin/sh` unless given) runs the launcher, which
 * finds bash on the PATH the rule keeps and starts the shipped hook. `env` adds to the run's
 * variables.
 */
export function launched(
  l: Layout,
  r: Run,
  name: string,
  input: string,
  env: Record<string, string> = {},
  sh = "/bin/sh",
): Promise<Answer> {
  return fire(l, r, [sh, join(HOOKS, "run-hook.sh"), join(HOOKS, name)], input, env);
}

/** `argv` run from `r.cwd` with `input` on stdin, started directly: no shell reads `more` first. */
async function fire(
  l: Layout,
  r: Run,
  argv: string[],
  input: string,
  more: Record<string, string> = {},
): Promise<Answer> {
  const out = await spawnWith(argv, r.cwd, { ...hookEnv(l, r), ...more }, input);
  return (await seen(l)) ?? refusal(out.stderr, out.code) ?? { exit: out.code };
}

/** The variables a hook is started with: no more than the run's PATH, the project and the state. */
const hookEnv = (l: Layout, r: Run) => ({
  ...hermetic(),
  ...path(r),
  CLAUDE_PROJECT_DIR: r.project ?? l.repo,
  XDG_STATE_HOME: l.state,
});

/**
 * The hook script at `file`, run by bash as `hook` runs one, `more` added to its variables: its exit
 * and its stderr, as written. `input` may be bytes no string encodes.
 */
export function hookAt(l: Layout, r: Run, file: string, input: Input, more = {}) {
  return spawnWith([r.bash, file], r.cwd, { ...hookEnv(l, r), ...more }, input);
}

/** What a run is fed on stdin: text, written as UTF-8, or bytes as they are. */
type Input = string | Uint8Array;

/** `argv` started with exactly `env`, `input` on stdin: its exit and what it wrote on stderr. */
export async function spawnWith(
  [cmd, ...args]: string[],
  cwd: string,
  env: Record<string, string>,
  input: Input,
): Promise<{ code: number; stderr: string }> {
  const child = new Deno.Command(cmd, {
    args,
    cwd,
    clearEnv: true,
    env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  await feed(child.stdin, input);
  const out = await child.output();
  return { code: out.code, stderr: new TextDecoder().decode(out.stderr) };
}

/**
 * `input` written to `stdin`, then closed. A hook that refuses may exit before it reads a byte: the
 * write then breaks its pipe, which is that refusal's own outcome, never the test's failure.
 */
export async function feed(stdin: WritableStream<Uint8Array>, input: Input): Promise<void> {
  const writer = stdin.getWriter();
  try {
    await writer.write(typeof input === "string" ? new TextEncoder().encode(input) : input);
    await writer.close();
  } catch (err) {
    if (!(err instanceof Deno.errors.BrokenPipe)) throw err;
  }
}
