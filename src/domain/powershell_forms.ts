/**
 * The PowerShell forms that set PATH, or may, in a way no reading of a value gives whole. Each is
 * keyed on the reference or the primitive a command needs, never on the name of a cmdlet, since an
 * alias renames a cmdlet and leaves its argument as written. Each is searched in a whole string,
 * as written and as PowerShell reads it (`powershell_path.ts`). Reflection through none of these
 * primitives is not read: no list of them can be complete.
 */

/**
 * PowerShell's PATH, `$env:Path` or `${env:Path}`: in any letter case, as PowerShell reads a
 * variable's name. The one source every pattern naming it is built from.
 */
export const PS_PATH = String.raw`\$(?:env:path\b|\{env:path\})`;

const QUOTE = "['\"\u2018-\u201E]";

/**
 * A quoted piece of the name `env:Path` joined to another (`'en' + 'v:Path'`, `'e','nv'`): a drive
 * computed from parts. Every piece of the name, longest first.
 */
const PIECE = (() => {
  const name = "env:path";
  const pieces = new Set<string>();
  for (let i = 0; i < name.length; i++) {
    for (let j = i + 1; j <= name.length; j++) pieces.add(name.slice(i, j));
  }
  return [...pieces].sort((a, b) => b.length - a.length).join("|");
})();

/** Each form, by what it is; a match of any one, as written or as read, leaves a source unread. */
export const PS_UNREAD_FORMS: readonly (readonly [form: string, pattern: RegExp])[] = [
  ["an env: drive reference", /(?<![\w$])(?<!\$\{)env:/i],
  ["a braced provider path", /\$\{env:[\\/]/i],
  ["the Environment provider", /environment::/i],
  ["a drive named before `:Path` at run time", /(?<!\$env|\$\{env):path\b/i],
  [
    "`env` beside a quote, a `+` or a `$(`",
    new RegExp(`(?:${QUOTE}|\\+|\\$\\()env|env(?:${QUOTE}|\\+|\\$\\()`, "i"),
  ],
  [
    "a quoted piece of the name, joined",
    new RegExp(`[+,]\\s*${QUOTE}(?:${PIECE})${QUOTE}|${QUOTE}(?:${PIECE})${QUOTE}\\s*[+,]`, "i"),
  ],
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
  ["a call of a computed name", new RegExp(`(?<!&)&(?!&)\\s*(?:\\(|${QUOTE})`)],
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
 * An option that hands PowerShell an encoded command: `-EncodedCommand` or any of its prefixes from
 * `-e`, or `-ec`, after a `-`, a `/` or a dash PowerShell reads as one (`–`, `—`, `―`), in any
 * letter case. Never `-ex` or `-ep`, which set the execution policy.
 */
const ENCODED =
  /^[-/\u2013\u2014\u2015](?:e(?:n(?:c(?:o(?:d(?:e(?:d(?:c(?:o(?:m(?:m(?:a(?:nd?)?)?)?)?)?)?)?)?)?)?)?)?|ec)(?::|$)/i;

/**
 * Whether a line of `text` runs PowerShell with an encoded command: an option of {@link ENCODED}
 * after a word naming it. Its words are split on blanks, their quotes aside, so the time is that of
 * reading the text once.
 */
export function encodedCommand(text: string): boolean {
  return text.split("\n").some((line) => {
    const words = line.split(/\s+/).map((w) => w.replace(/^['"]+|['"]+$/g, ""));
    const shell = words.findIndex((w) => SHELL.test(w));
    return shell >= 0 && words.slice(shell + 1).some((w) => ENCODED.test(w));
  });
}
