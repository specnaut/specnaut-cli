import { assertEquals } from "@std/assert";
import { type Answer, hook, type Run } from "./resolve_verifier_fixture.ts";
import { fired, type Layout } from "./resolve_verifier_layout.ts";

/** What review-gate.sh's spelling tests share: the input they send, and how they read its answers. */

/** The hook's input for a Bash call of `command`, with a description if given. */
export const bashCall = (command: string, description?: string) =>
  JSON.stringify({
    cwd: "/work",
    tool_input: { command, ...(description ? { description } : {}) },
  });

/** review-gate.sh's answer to each line, by line, run as `r` says; then no marker may have fired. */
export async function gate(l: Layout, r: Run, lines: string[]): Promise<Record<string, Answer>> {
  const out: Record<string, Answer> = {};
  for (const line of lines) out[line] = await hook(l, r, "review-gate.sh", bashCall(line));
  assertEquals(await fired(l), "", "a command the PATH entry supplied ran");
  return out;
}

/** The same `answer` for each line, as `gate` reports them. */
export const each = (lines: string[], answer: Answer) =>
  Object.fromEntries(lines.map((line) => [line, answer]));

/** A run whose PATH starts with the tree's `bin`, which the hook drops, and what it then answers. */
export const dropping = (l: Layout, bash: string) => ({
  r: { entries: [l.bin, l.tools], cwd: l.repo, bash },
  want: { refused: "is inside the repository", entry: l.bin, exit: 2 },
});
