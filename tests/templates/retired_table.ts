import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

/**
 * The `/specnaut` router's "Retired addresses" section, parsed — the one home
 * of which addresses are retired (plan 037 § 5). Shared by the two locks that
 * read it, so neither keeps a second, literal list beside it:
 *
 *   - `retired_addresses_test.ts` (FR-006): no shipped file names a retired
 *     address outside this section;
 *   - `phase_mentions_resolve_test.ts`: every `/specnaut|/task|/ship <verb>` a
 *     shipped file names is routed, or is a row here.
 */

/** One retired address, split into the skill the user typed and its verb. */
export interface RetiredAddress {
  /** Verbatim, as the table's first column spells it: `/specnaut plan`, `/board`. */
  readonly address: string;
  /** The skill name without its slash: `specnaut`, `board`, `sec-audit`. */
  readonly skill: string;
  /** The verb after the skill, or null when the whole skill retired. */
  readonly verb: string | null;
}

const HEADING = /^## Retired addresses\b/;

/** The bundled `/specnaut` router — the section's only legitimate home. */
export function specnautRouter(): string {
  const e = CORE_BUNDLE.find((x) => x.category === "skill" && x.name === "specnaut");
  if (!e) throw new Error("no bundled /specnaut router");
  return e.content;
}

/**
 * The section's text, heading included, up to the next H2 or the end of the
 * file. Empty when the heading is gone — callers assert non-vacuity.
 */
export function retiredSection(router: string = specnautRouter()): string {
  const lines = router.split("\n");
  const start = lines.findIndex((l) => HEADING.test(l));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

/**
 * Every address the section retires, read from the FIRST column of its tables
 * only. The second column holds the successors (`/task plan`, `/ship tag`), and
 * counting those would retire the very addresses users are sent to.
 *
 * Two tables: one that names the retired address in full (`/specnaut plan`,
 * `/board`), and one of former `/specnaut` phases gone without a successor
 * address, which names the bare phase (`brainstorm`) — read as `/specnaut
 * brainstorm`, since that is what a stale instruction would spell.
 */
export function retiredAddresses(section: string = retiredSection()): RetiredAddress[] {
  const out: RetiredAddress[] = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const first = line.split("|")[1];
    const m = /^\s*`([^`]+)`/.exec(first);
    if (!m) continue;
    const token = m[1].trim();
    const full = token.startsWith("/") ? token : `/specnaut ${token}`;
    const [skill, verb] = full.slice(1).split(/\s+/, 2);
    out.push({ address: full, skill, verb: verb ?? null });
  }
  return out;
}

/**
 * Every address a successor cell names, as skill + verb (cli#709). A cell can
 * name several (`/task` (`list`, `next`, …)) and carry arguments
 * (`/task audit --security`, `/task plan <feature>`); reading only the first
 * token, exactly, let a retired verb hide behind either. A bare verb token
 * belongs to the last skill named before it; an argument is dropped.
 */
export function successorAddresses(cell: string): string[] {
  const out: string[] = [];
  let skill: string | null = null;
  for (const [, token] of cell.matchAll(/`([^`]+)`/g)) {
    const [head, next] = token.trim().split(/\s+/);
    const isVerb = (w: string | undefined) => w !== undefined && /^[a-z][a-z-]*$/.test(w);
    if (head.startsWith("/")) {
      skill = head;
      out.push(isVerb(next) ? `${head} ${next}` : head);
    } else if (skill !== null && isVerb(head)) out.push(`${skill} ${head}`);
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every spelling a harness gives the address. A whole retired skill `S` is
 * `/S` (Claude), `$S` (Codex), `specnaut-S` (namespaced: Codex, Cursor,
 * OpenCode, Copilot) and `specnaut-plugin:S` (the plugin). A retired verb `V`
 * of `/specnaut` is `/specnaut V`, `$specnaut V`, `/specnaut-V` on a flat
 * layout, and `specnaut-plugin:specnaut V`.
 *
 * The lookbehind keeps a path out (`skills/board/`, `.specnaut/addenda/board/`):
 * an address is a command a person types, not a directory name.
 */
export function patternFor(a: RetiredAddress): RegExp {
  const before = "(?<![A-Za-z0-9_./:-])";
  const plugin = "[/$]?specnaut-plugin:";
  if (a.verb === null) {
    const s = esc(a.skill);
    const after = "(?![A-Za-z0-9_-])";
    return new RegExp(
      `${before}(?:[/$]|${plugin}|[/$]?specnaut-)${s}${after}`,
      "g",
    );
  }
  const s = esc(a.skill);
  const v = esc(a.verb);
  // `-` may follow: `/specnaut audit-security` is a spelling of the retired
  // `/specnaut audit` ("any axis or spelling"), not a different address.
  const after = "(?![A-Za-z0-9_])";
  return new RegExp(
    `${before}(?:[/$]|${plugin})${s}[ -]${v}${after}|${before}[/$]${s}-${v}${after}`,
    "g",
  );
}
