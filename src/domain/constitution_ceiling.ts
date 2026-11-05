import { CONSTITUTION_PATH } from "./constitution_paths.ts";
import { countLines, DEFAULT_CONSTITUTION_LIMIT, type SizeLimit } from "./size_limits.ts";

/** How far over its ceiling the constitution is. */
export type OverCeiling = { readonly lines: number; readonly ceiling: number };

/**
 * The constitution's size against its ceiling, or `null` when it is within
 * it (or the ceiling is `none`). The one home of this judgement: `check` and
 * the upgrade notice both ask it, so neither counts lines itself.
 */
export function constitutionOverCeiling(
  text: string,
  limit: SizeLimit = DEFAULT_CONSTITUTION_LIMIT,
): OverCeiling | null {
  if (limit.ceiling === null) return null;
  const lines = countLines(text);
  return lines > limit.ceiling ? { lines, ceiling: limit.ceiling } : null;
}

/** What `check` and `upgrade` say about an over-ceiling constitution. */
export function constitutionCeilingNote(over: OverCeiling): string {
  return `${CONSTITUTION_PATH} is ${over.lines} lines, over its ceiling of ${over.ceiling} — ` +
    `shrink it; every session loads it`;
}
