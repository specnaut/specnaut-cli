import { DELIMITER, fromFileUrl, join } from "@std/path";
import { run } from "./git_sandbox.ts";
import { ifMissing, type Layout, type Shells } from "./resolve_verifier_layout.ts";

/**
 * The five spellings of the rule that judges the PATH and resolves `specnaut` before anything runs:
 * the resolve block of `phases/script-gate.md` (run by bash, and by zsh where it is installed),
 * `_verifier.sh` as `land-feature.sh` sources it, and the three Claude Code hooks. They cannot share
 * code, so one table of PATHs runs every one of them, in the layout of resolve_verifier_layout.ts.
 */

const TEMPLATES = new URL("../../templates/", import.meta.url);
const at = (path: string) => fromFileUrl(new URL(path, TEMPLATES));
const BASH_DIR = at("core/specnaut/scripts/bash/");
const HOOKS = at("harness-specific/claude/hooks/");

/** The bash block after the resolve anchor in the gate doc, as written. */
function docBlock(): string {
  const doc = Deno.readTextFileSync(at("core/skills/task/phases/script-gate.md"));
  const after = doc.split("<!-- script-gate: resolve-verifier -->")[1];
  const m = /^\s*```bash\n([\s\S]*?)\n```/.exec(after ?? "");
  if (!m) throw new Error("script-gate.md lost its resolve block");
  return m[1];
}

/** `_verifier.sh` as land-feature.sh runs it: its shell options, alias and ERR trap first. */
const LAND = `set -Eeuo pipefail
shopt -s expand_aliases
alias git='git -c core.hooksPath=/dev/null'
trap 'echo "ERR trap: $BASH_COMMAND" >&2; exit 12' ERR
. '${join(BASH_DIR, "_verifier.sh")}'
refuse_unsafe_path
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

/** One run of a spelling: the PATH, where it runs from, and the shells that run it. */
export type Run = { entries: string[]; cwd: string } & Shells;

/** A doc block or `_verifier.sh` run: what `sn` was set to, else the refusal it printed. */
async function resolver(shell: string, flags: string[], code: string, r: Run): Promise<Answer> {
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

/** A hook as Claude Code runs it, `input` on stdin: what the stub saw, a refusal, or the exit. */
export async function hook(l: Layout, r: Run, name: string, input: string): Promise<Answer> {
  const file = join(l.tmp, "input");
  await Deno.writeTextFile(file, input);
  const env = { ...path(r), CLAUDE_PROJECT_DIR: l.repo, XDG_STATE_HOME: l.state };
  const out = await run(
    r.bash,
    ["-c", '"$0" "$1" <"$2"', r.bash, join(HOOKS, name), file],
    r.cwd,
    env,
  );
  return (await seen(l)) ?? refusal(out.stderr, out.code) ?? { exit: out.code };
}
