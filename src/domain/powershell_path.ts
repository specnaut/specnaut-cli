import { computedItemPath, encodedCommand, PS_PATH, PS_UNREAD_FORMS } from "./powershell_forms.ts";
import {
  type HashReading,
  normalizedPowerShell,
  type PsText,
  writtenAs,
} from "./powershell_text.ts";
import { readableValue, valueItems } from "./powershell_value.ts";

/**
 * How PowerShell sets PATH, read as text, never run: `$env:Path` or `${env:Path}` assigned a value,
 * whose words `pathAssignments` (`command_search_path.ts`) reads, and the ways of setting it that
 * reading cannot give whole. A static reader cannot run a cmdlet, so a value built by one is
 * named as not read whole rather than guessed at: a guessed folder describes a PATH other than the
 * one the command runs with.
 */

/** A word naming PowerShell's PATH, and what a glued `=` or `+=` sets it to. */
export const PS_PATH_WORD = new RegExp(`^${PS_PATH}(?:\\+?=(.*))?$`, "is");
/** Every PowerShell PATH in a text, for `replace` alone: a global regex keeps state across `test`. */
const EVERY_PS_PATH = new RegExp(PS_PATH, "gi");

/** `value` with each PowerShell PATH in it read as `$PATH`, the PATH in effect. */
export const psPathAsShell = (value: string): string => value.replace(EVERY_PS_PATH, "$$PATH");

/**
 * Whether `text` sets PATH, or may, in a way `pathAssignments` reads no value from: a form of
 * `powershell_forms.ts` (the `env:` drive, a provider, a new drive, an assignment of another shape,
 * code or a member built at run time, a write the next session inherits), searched in the text as
 * written and as PowerShell reads it (`powershell_text.ts`), each `#` inside a token read both
 * ways; or a PATH, or its assignment, that only the text as read spells (``${env:Pat`h}``,
 * `$env:Path <#…#>=`). Every assignment the reading finds is so either read from the text as
 * written, where it is spelled the same at the same place, or leaves its source unread.
 */
export function setsPathUnread(text: string): boolean {
  if (unreadForm(text)) return true;
  if (!/[`#]/.test(text)) return false;
  return HASH_READINGS.some((hash) => {
    const read = normalizedPowerShell(text, hash);
    return unreadForm(read.text) || spelledOnlyAsRead(read);
  });
}

const HASH_READINGS: readonly HashReading[] = ["comment", "literal"];

const unreadForm = (text: string): boolean =>
  PS_UNREAD_FORMS.some(([, pattern]) => pattern.test(text)) || encodedCommand(text) ||
  computedItemPath(text);

/** PowerShell's PATH assigned, `=` or `+=`, glued or not. */
const PS_PATH_SET = new RegExp(`${PS_PATH}\\s*\\+?=`, "gi");

/** Whether a PATH or its assignment in `read` is not as written at the same place. */
function spelledOnlyAsRead(read: PsText): boolean {
  return [EVERY_PS_PATH, PS_PATH_SET].some((spelling) =>
    [...read.text.matchAll(spelling)].some((m) => !writtenAs(read, m.index, m.index + m[0].length))
  );
}

/**
 * Whether a command string assigns PowerShell's PATH a value no reading of its words gives whole
 * (`readableValue`); its source is then not read whole. The string is searched, not its words: the
 * split into words takes off the quotes and the brackets that say how the value is built, and an
 * assignment in a command nested in quotes (`pwsh -c "$env:Path = (…)"`) is in the string as
 * written. The value ends at `;`, a comment's `#` or a line's end outside quotes; a `|` or an `&`
 * before it is in the value, which a pipeline or a call builds. `+=` is read as `$env:Path +`. A
 * value with no item is not read whole: PowerShell reads it on the next line (`$env:Path =⏎…`).
 */
export function buildsPathUnread(text: string): boolean {
  for (const set of text.matchAll(PS_PATH_SET)) {
    const items = valueItems(text, set.index + set[0].length);
    const appended = set[0].endsWith("+=") ? ["$env:Path", "+"] : [];
    if (items.length === 0 || !readableValue([...appended, ...items])) return true;
  }
  return false;
}

/**
 * Whether a word a shell splits a command into assigns PowerShell's PATH a value no reading gives
 * whole (`buildsPathUnread`), where the strings as written spell that assignment fewer times than
 * the words do: one spelled across quotes a shell joins (`'$env:Pa''th = (…)'`), which a search of
 * the strings never meets. A word whose assignment the strings spell as it is is read from them:
 * the split takes off the quotes its value is read by (`$env:Path+=';x'` is `$env:Path+=;x`). A
 * word inside another is that one split again, and not counted twice. Past
 * {@link MAX_SETTING_WORDS} such words the reading is not whole.
 */
export function joinedPathUnread(strings: readonly string[], words: readonly string[]): boolean {
  const setting = [...new Set(words.filter((w) => w.match(PS_PATH_SET) !== null))];
  if (setting.length > MAX_SETTING_WORDS) return true;
  const own = setting.filter((w) => !setting.some((other) => other !== w && other.includes(w)));
  const counts = new Map<string, number>();
  for (const m of own.flatMap((w) => [...w.matchAll(PS_PATH_SET)])) {
    counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  }
  const written = (set: string) => strings.reduce((n, s) => n + s.split(set).length - 1, 0);
  const joined = [...counts].filter(([set, n]) => written(set) < n).map(([set]) => set);
  return own.some((w) => joined.some((set) => w.includes(set)) && buildsPathUnread(w));
}

const MAX_SETTING_WORDS = 256;
