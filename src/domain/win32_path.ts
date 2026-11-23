import { sameEntry } from "./instruction_head.ts";
import { type BaseEntry, REASON, type Untrusted } from "./script_trust.ts";
import { win32Name } from "./tree_names.ts";

/**
 * A path as the instruction class reads it on Windows. Win32 opens `.claude./settings.json`,
 * `.claude /settings.json` and `.claude/settings.json::$DATA` as `.claude/settings.json`, so
 * scope is decided on {@link win32Fold}. A volume that keeps 8.3 short names also opens
 * `CLAUDE~1/` as `.claude/`, and which long name a short one stands for is the volume's choice
 * (past `~4` it is a hash), so a name of that shape ({@link holdsShortName}) is never matched to
 * one: it is asked about unless the base holds it as written.
 */

/** The reason a path holding a name shaped like a Windows short name gets. */
export const SHORT_NAME_REASON = "name shaped like a Windows short name";

/** The reason a path Win32 opens under another name, trimmed or read as a stream, gets. */
export const WIN32_ALIAS_REASON = "name Windows opens as another";

/** An 8.3 short name: up to six characters, `~` and a number, an extension of up to three. */
const SHORT_NAME = /^[^~.]{1,6}~\d+(\.[^.]{0,3})?$/i;

/** `path` with each name as Win32 opens it (`win32Name` in `tree_names.ts`), in lower case. */
export const win32Fold = (path: string): string => path.split("/").map(win32Name).join("/");

/** Whether a name of `path`, as Win32 opens it, is shaped like an 8.3 short name. */
export const holdsShortName = (path: string): boolean =>
  path.split("/").some((name) => SHORT_NAME.test(win32Name(name)));

/** The reason a path Win32 may open as another gets, a short name's first; `null` for neither. */
export function win32Reason(path: string): string | null {
  if (holdsShortName(path)) return SHORT_NAME_REASON;
  return win32Fold(path) === path.toLowerCase() ? null : WIN32_ALIAS_REASON;
}

/**
 * A path holding a short name outside the instruction roots is walked in no tree, so it is judged
 * at HEAD alone (`e`): named unless the tip holds it as written (`atTip`), then by that entry.
 */
export function shortNameReasons(e: BaseEntry, atTip: BaseEntry | undefined): Untrusted[] {
  if (atTip === undefined) return [{ path: e.path, reason: SHORT_NAME_REASON }];
  return sameEntry(e, atTip) ? [] : [{ path: e.path, reason: REASON.differs }];
}
