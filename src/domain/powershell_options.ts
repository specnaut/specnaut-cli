/**
 * The options that hand a PowerShell launcher (`pwsh`, `powershell`) what it runs: a command, a
 * script file, an encoded command. PowerShell reads an option by a prefix of its name, after a
 * `-`, a `/` or a dash it reads as one (`–`, `—`, `―`), in any letter case, and its value glued
 * after a `:` or as the next word. One predicate, so each reader of a launcher's words names an
 * option the same way (`powershell_forms.ts`, `generated_code.ts`).
 */

/** What an option hands the launcher. */
export type PsOptionKind = "command" | "file" | "encodedcommand";

/**
 * Whether `word` is an option handing PowerShell `kind`, read generously so a spelling PowerShell
 * takes is never missed: `-Command` or any prefix of it from `-c`, and `-CommandWithArgs` (`-cwa`);
 * `-File` or any prefix from `-f`; `-EncodedCommand` or any prefix from `-e`, or `-ec`, never `-ex`
 * or `-ep`, which set the execution policy.
 */
export function psOption(word: string, kind: PsOptionKind): boolean {
  if (!/^[-/–—―]/.test(word)) return false;
  const option = word.slice(1).split(":")[0].toLowerCase();
  if (option === "") return false;
  if (kind === "encodedcommand") return option === "ec" || "encodedcommand".startsWith(option);
  if (kind === "command") return option === "cwa" || "commandwithargs".startsWith(option);
  return "file".startsWith(option);
}
