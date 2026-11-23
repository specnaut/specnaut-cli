import { quotedEnd } from "./powershell_text.ts";

/**
 * The PowerShell forms that set PATH, or may, in a way no reading of a value gives whole. Each is
 * keyed on the reference or the primitive a command needs: an `env:` path as written, a drive or a
 * provider, code or a member built at run time, and a path an item cmdlet is handed that is not a
 * constant (`computedItemPath`), since no list of the ways to spell a drive's name at run time can
 * be complete. Each is searched in a whole string, as written and as PowerShell reads it
 * (`powershell_path.ts`). Reflection through none of these primitives is not read.
 */

/**
 * PowerShell's PATH, `$env:Path` or `${env:Path}`: in any letter case, as PowerShell reads a
 * variable's name. The one source every pattern naming it is built from.
 */
export const PS_PATH = String.raw`\$(?:env:path\b|\{env:path\})`;

const QUOTE = "['\"\u2018-\u201E]";

/** Each form, by what it is; a match of any one, as written or as read, leaves a source unread. */
export const PS_UNREAD_FORMS: readonly (readonly [form: string, pattern: RegExp])[] = [
  ["an env: drive reference", /(?<![\w$])(?<!\$\{)env:/i],
  ["a braced provider path", /\$\{env:[\\/]/i],
  ["the Environment provider", /environment::/i],
  ["New-PSDrive", /\bnew-psdrive\b/i],
  ["ndr", /\bndr\b/i],
  ["mount", /\bmount\b/i],
  ["a drive made through session state", /\.drive\.new\b/i],
  ["PATH in a multiple assignment", new RegExp(`${PS_PATH}\\s*,`, "i")],
  [
    "PATH assigned with `??=` or another operator",
    new RegExp(`${PS_PATH}\\s*(?:\\?\\?|[-*/%])=`, "i"),
  ],
  ["Invoke-Expression", /\binvoke-expression\b|\biex\b/i],
  ["a script block made from text", /scriptblock\]::create\b/i],
  ["InvokeScript", /\binvokescript\b/i],
  ["NewScriptBlock", /\bnewscriptblock\b/i],
  ["Invoke-Command", /\binvoke-command\b|\bicm\b/i],
  ["a call of a computed name", new RegExp(`(?<!&)&(?!&)\\s*(?:\\(|\\$|${QUOTE})`)],
  ["a script a variable names, dot-sourced", /(?:^|[;|&({}\n])\s*\.\s*\$/],
  ["Add-Type", /\badd-type\b/i],
  ["a static member named at run time", new RegExp(`::\\s*(?:\\$|\\(|${QUOTE})`)],
  ["GetMethod", /\.getmethods?\s*\(/i],
  ["InvokeMember", /\binvokemember\b/i],
  ["session state", /\$executioncontext\.sessionstate\b|sessionstateproxy/i],
  ["InvokeProvider", /\binvokeprovider\b/i],
  ["SetEnvironmentVariable", /setenvironmentvariable/i],
  ["setx", /\bsetx\b/i],
  ["the registry's Environment key", /[\\/:]environment\b/i],
];

/** Each word of a line that runs PowerShell: `pwsh` or `powershell`, a path or `.exe` with it. */
const SHELL = /(?:^|[\\/])(?:pwsh|powershell)(?:\.exe)?$/i;

/**
 * Whether `word` is an option that hands PowerShell an encoded command: `-EncodedCommand` or any of
 * its prefixes from `-e`, or `-ec`, after a `-`, a `/` or a dash PowerShell reads as one
 * (`–`, `—`, `―`), in any letter case. Never `-ex` or `-ep`, which set the execution policy.
 */
function encodedOption(word: string): boolean {
  if (!/^[-/\u2013\u2014\u2015]/.test(word)) return false;
  const option = word.slice(1).split(":")[0].toLowerCase();
  return option === "ec" || (option !== "" && "encodedcommand".startsWith(option));
}

/** Whether one command's words run PowerShell with an encoded command: an option after its name. */
export function encodedWords(words: readonly string[]): boolean {
  const shell = words.findIndex((w) => SHELL.test(w));
  return shell >= 0 && words.slice(shell + 1).some(encodedOption);
}

/**
 * Whether a line of `text` runs PowerShell with an encoded command (`encodedWords`), its words
 * split at blanks and at what ends a command (`;`, `&`, `|`, a bracket), their quotes and
 * backticks taken off: the time is that of reading the text once. The words a shell splits a
 * command into are searched too (`command_words.ts`).
 */
export function encodedCommand(text: string): boolean {
  return text.split("\n").some((line) =>
    encodedWords(line.split(/[\s;&|(){}]+/).map((w) => w.replace(/['"`\u2018-\u201E]/g, "")))
  );
}

/**
 * The cmdlets that write an item, its content or a property at a path, and their aliases, and
 * those that set the location a relative path starts from. `cp`, `mv`, `cd` and `pushd` are left
 * out: in a command string they name the shell's own utilities far more often than PowerShell's.
 */
const ITEM_CMDLETS = new Set([
  ..."set-item si new-item ni add-content ac set-content sc clear-item cli clear-content clc".split(
    " ",
  ),
  ..."copy-item copy cpi move-item move mi rename-item ren rni set-location sl chdir".split(" "),
  ..."push-location set-itemproperty sp new-itemproperty clear-itemproperty clp".split(" "),
  ..."copy-itemproperty cpp move-itemproperty mp rename-itemproperty rnp".split(" "),
]);
/** The position of the value, not a path, among each such cmdlet's arguments. */
const VALUE_AT = new Map<string, number>([
  ..."set-item si set-content sc add-content ac".split(" ").map((c) => [c, 1] as [string, number]),
  ..."set-itemproperty sp new-itemproperty".split(" ").map((c) => [c, 2] as [string, number]),
]);
/** The parameters whose value is not a path, by a prefix of their names, and those taking none. */
const NOT_PATH = /^(?:va(?:l(?:ue?)?)?|enc\w*|it\w*|ty\w*)$/i;
const SWITCH = /^(?:force|passthru|recurse|whatif|confirm|verbose|debug|nonewline|asbytestream)$/i;
/** A word in a command's place, a module's name before it or not (`Microsoft.PowerShell.Core\`). */
const COMMAND = /(?<=^|[\s;|&({}=])(?:[\w.]+\\)?([a-z][\w-]*)(?=$|[\s;|)}])/gi;
/** What makes a path built at run time: a variable or a `$(…)`, a bracket, a `+`, a `[char]`. */
const BUILT = /[$({+]|\[char\]/i;
/**
 * A path the current location decides: `Path` itself, as a name relative to it (`.\Path`), or a
 * wildcard. Wherever the location was set (`cd ("en"+"v:")`), such a path may be PATH's item.
 */
const RELATIVE = /^['"]?(?:\.[\\/])?path['"]?$|[*?[]/i;

/**
 * Whether `text` hands an item cmdlet a path that is not a constant: one holding what
 * {@link BUILT} names (`si "E$()nv$([char]58)Pa$()th" tools`, a name from `(gdr -PSProvider
 * Environment).Name`), one the location decides ({@link RELATIVE}), or none at all after a `|`,
 * which the pipeline gives (`gci env: | si -Value tools`). Such a path may name any drive, so no
 * spelling of the environment's can be listed.
 */
export function computedItemPath(text: string): boolean {
  for (const m of text.matchAll(COMMAND)) {
    const name = m[1].toLowerCase();
    if (!ITEM_CMDLETS.has(name)) continue;
    const paths = pathArguments(name, argumentsAt(text, m.index + m[0].length));
    const piped = /(?<!\|)\|\s*$/.test(text.slice(Math.max(0, m.index - 64), m.index));
    if (paths.some((p) => BUILT.test(p) || RELATIVE.test(p))) return true;
    if (piped && paths.length === 0) return true;
  }
  return false;
}

/**
 * The path arguments among `args`: each positional one but the value, and each parameter's value
 * but those {@link NOT_PATH} names.
 */
function pathArguments(name: string, args: readonly string[]): string[] {
  const paths: string[] = [];
  for (let i = 0, at = 0; i < args.length; i++) {
    const parameter = /^-([a-z][\w-]*)(?::(.*))?$/is.exec(args[i]);
    if (parameter === null) {
      if (VALUE_AT.get(name) !== at++) paths.push(args[i]);
    } else if (parameter[2] !== undefined) {
      if (!NOT_PATH.test(parameter[1])) paths.push(parameter[2]);
    } else if (!SWITCH.test(parameter[1]) && i + 1 < args.length) {
      if (!NOT_PATH.test(parameter[1])) paths.push(args[i + 1]);
      i++;
    }
  }
  return paths;
}

/**
 * The arguments from `at` to the command's end, each quoted string and each bracket's inside kept
 * whole within its argument.
 */
function argumentsAt(text: string, at: number): string[] {
  const args: string[] = [];
  let [arg, depth, i] = ["", 0, at];
  while (i < text.length && (depth > 0 || !/[;|&\r\n)}]/.test(text[i]))) {
    const c = text[i];
    const end = /['"\u2018-\u201E]/.test(c) ? quotedEnd(text, i) : i + 1;
    if (c === "(" || c === "{") depth++;
    else if (c === ")" || c === "}") depth--;
    if (depth === 0 && /\s/.test(c)) {
      if (arg !== "") args.push(arg);
      arg = "";
    } else arg += text.slice(i, end);
    i = end;
  }
  return arg === "" ? args : [...args, arg];
}
