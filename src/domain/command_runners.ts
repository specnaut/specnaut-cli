/**
 * A program that runs what a manifest in its folder lists (`npm run lint`, `make`): when it is the
 * first word of a command, that manifest is a file the command runs. Only the first word counts:
 * `npm` in a permission rule's text (`Bash(npm test:*)`) runs nothing, and reading it as a runner
 * would judge `package.json` on every dependency bump. The table is closed: a runner it does not
 * list names no manifest, a limit `phases/script-gate.md`'s `instructions` row states by naming
 * each runner here (`tests/templates/instruction_limits_docs_test.ts` keeps the two together).
 */
export const RUNNERS: ReadonlyMap<string, readonly string[]> = new Map([
  ["npm", ["package.json"]],
  ["pnpm", ["package.json"]],
  ["yarn", ["package.json"]],
  ["bun", ["package.json"]],
  ["make", ["Makefile", "makefile", "GNUmakefile"]],
  ["gmake", ["Makefile", "makefile", "GNUmakefile"]],
  ["just", ["justfile", ".justfile", "Justfile"]],
  ["deno", ["deno.json", "deno.jsonc"]],
]);

/** Words before the program: a variable set for it (`CI=1`), or a program that runs the next. */
const isPrelude = (word: string) =>
  /^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || ["exec", "env", "command"].includes(word);

/** The manifests the program one command (its `words`) starts reads, by its name. */
export function manifestsOf(words: readonly string[]): readonly string[] {
  const program = words.find((w) => !isPrelude(w));
  if (program === undefined) return [];
  return RUNNERS.get(program.slice(program.lastIndexOf("/") + 1)) ?? [];
}
