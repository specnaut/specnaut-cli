import { isAbsolute, join } from "@std/path";

/** The hook registrations of a `.claude/settings.json`, as the upgrade tests read them. */

export type Registration = { event: string; matcher: string | undefined; command: string };

// deno-lint-ignore no-explicit-any
export function registrations(settings: any): Registration[] {
  const out: Registration[] = [];
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    // deno-lint-ignore no-explicit-any
    for (const g of groups as any[]) {
      for (const h of g.hooks ?? []) out.push({ event, matcher: g.matcher, command: h.command });
    }
  }
  return out;
}

export const readSettings = async (dir: string) =>
  JSON.parse(await Deno.readTextFile(join(dir, ".claude/settings.json")));

/** Every `.sh` a command runs, as an absolute path in `dir`. */
export function scriptsRun(command: string, dir: string): string[] {
  const expanded = command.replaceAll("$CLAUDE_PROJECT_DIR", dir);
  return [...expanded.matchAll(/[^\s"']+\.sh/g)].map(([p]) => isAbsolute(p) ? p : join(dir, p));
}
