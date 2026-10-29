import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";
import { type RetiredAddress, retiredAddresses, retiredSection } from "./retired_table.ts";

/**
 * FR-006 (cli#683) — no shipped file names a retired address outside the one
 * table that retires it, the "Retired addresses" section of the `/specnaut`
 * router.
 *
 * A retired address in an agent, a phase doc or a hook is an instruction that
 * now leads nowhere: `/board` and the `*-audit` skills are not installed, so
 * the harness answers "unknown skill", and `/specnaut plan` prints a one-line
 * redirect instead of planning. Spec 034 found five skills and four agents in
 * that state once the audit phases were gone; this lock exists so the next
 * move is caught by a test rather than by a user.
 *
 * **The addresses are parsed from the section, never listed here** (plan 037
 * § 5): a literal list beside the test would be a second home for the decision,
 * and would only catch the names someone remembered to copy.
 */

const REPO = fromFileUrl(new URL("../../", import.meta.url));

// ─── Exclusions — declared once, here, each with its reason ─────────────────
//
// Nothing else in this file skips a path. A scope root below that one day
// widens to reach one of these still skips it, for the reason written beside it.

const EXCLUDED: ReadonlyArray<{ path: string; reason: string }> = [
  {
    path: ".specnaut/specs/",
    reason: "feature plans record the move itself — naming the old address is their subject",
  },
  {
    path: "docs/upgrading/",
    reason: "upgrade guides tell a user on the old address where it went",
  },
  {
    path: "UPGRADING.md",
    reason: "the release-by-release upgrade notes, same reason as docs/upgrading/",
  },
  {
    path: "src/domain/skill_doc_renames.ts",
    reason: "the rename table maps every old address to its new one, by definition",
  },
  {
    path: "src/templates_bundle.ts",
    reason: "generated from templates/ — its content is scanned once, as CORE_BUNDLE and " +
      "HARNESS_STATIC, where the retired section is cut out precisely",
  },
];

/**
 * The retired section itself, in the router and in the router's plugin copy:
 * the one place a retired address MUST be named. Cut out of exactly these two
 * documents and nowhere else — the section's heading in any other file is not
 * an exemption.
 */
const SECTION_HOMES = new Set([
  "core:skill:specnaut",
  "plugin/skills/specnaut/SKILL.md",
]);

/**
 * In `src/`, a comment line records the history of a decision ("the previous
 * version printed `/board add`"), not an instruction anyone follows. Only the
 * code — the strings a user is shown — is scanned there.
 */
function codeLinesOnly(text: string): string {
  return text.split("\n").map((l) => {
    const t = l.trimStart();
    return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") ? "" : l;
  }).join("\n");
}

// ─── The matcher ────────────────────────────────────────────────────────────

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
function patternFor(a: RetiredAddress): RegExp {
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

const ADDRESSES = retiredAddresses();
const PATTERNS = ADDRESSES.map((a) => ({ address: a.address, re: patternFor(a) }));

function hits(where: string, content: string): string[] {
  const out: string[] = [];
  for (const { address, re } of PATTERNS) {
    for (const m of content.matchAll(re)) {
      const line = content.slice(0, m.index).split("\n").length;
      out.push(`${where}:${line}: ${m[0]}  (retired: ${address})`);
    }
  }
  return out;
}

// ─── The population ─────────────────────────────────────────────────────────

const posix = (p: string) => p.replaceAll("\\", "/");
const isExcluded = (rel: string) =>
  EXCLUDED.some((x) => x.path.endsWith("/") ? rel.startsWith(x.path) : rel === x.path);

/** Repository files under `root`, repo-relative and POSIX, minus the exclusions. */
async function filesUnder(root: string, exts?: string[]): Promise<string[]> {
  const out: string[] = [];
  for await (
    const e of walk(`${REPO}${root}`, { includeDirs: false, followSymlinks: false, exts })
  ) {
    const rel = posix(relative(REPO, e.path));
    if (rel.includes("/node_modules/") || isExcluded(rel)) continue;
    out.push(rel);
  }
  return out.sort();
}

interface Doc {
  readonly where: string;
  readonly source: string;
  readonly content: string;
}

function withoutSection(where: string, content: string): string {
  if (!SECTION_HOMES.has(where)) return content;
  const section = retiredSection(content);
  if (section === "") throw new Error(`${where} lost its Retired addresses section`);
  return content.replace(section, "");
}

async function population(): Promise<Doc[]> {
  const docs: Doc[] = [];
  for (const e of CORE_BUNDLE) {
    const where = e.suffix
      ? `core:${e.category}:${e.name}/${e.suffix}`
      : `core:${e.category}:${e.name}`;
    docs.push({ where, source: "bundle", content: withoutSection(where, e.content) });
  }
  for (const [h, files] of Object.entries(HARNESS_STATIC)) {
    for (const [dest, f] of Object.entries(files)) {
      docs.push({ where: `${h}:${dest}`, source: "static", content: f.content });
    }
  }
  const read = (rel: string) => Deno.readTextFileSync(`${REPO}${rel}`);
  for (const rel of await filesUnder("plugin")) {
    docs.push({ where: rel, source: "plugin", content: withoutSection(rel, read(rel)) });
  }
  for (const rel of [...await filesUnder("mods"), ...await filesUnder("hooks")]) {
    docs.push({ where: rel, source: rel.split("/")[0], content: read(rel) });
  }
  if (!isExcluded("README.md")) {
    docs.push({ where: "README.md", source: "readme", content: read("README.md") });
  }
  for (const rel of await filesUnder("src", [".ts"])) {
    docs.push({ where: rel, source: "src", content: codeLinesOnly(read(rel)) });
  }
  return docs;
}

// ─── The locks ──────────────────────────────────────────────────────────────

Deno.test("the retired section was found, and read from its first column only", () => {
  const got = new Set(ADDRESSES.map((a) => a.address));
  // Non-vacuity, one row per family the section must retire.
  for (
    const must of [
      "/specnaut plan",
      "/specnaut merge",
      "/specnaut tag-version",
      "/specnaut brainstorm",
      "/board",
      "/board update",
      "/code-audit",
      "/sec-audit",
      "/dep-audit",
    ]
  ) {
    assert(
      got.has(must),
      `the section no longer retires ${must} — or the parser stopped reading it`,
    );
  }
  // The successors live in the second column. Reading them would retire the
  // addresses users are sent to.
  for (const successor of ["/task plan", "/task", "/ship tag", "/task audit", "/task edit"]) {
    assert(!got.has(successor), `${successor} was read as retired`);
  }
});

Deno.test("the matcher fires on the section it reads from", () => {
  // A matcher that matches nothing reports a clean tree. Every row must be
  // found by its own pattern in the full, uncut router.
  const router = CORE_BUNDLE.find((e) => e.category === "skill" && e.name === "specnaut")!.content;
  // Rows of the "gone without a successor" table name the bare phase
  // (`brainstorm`), so only rows spelled in full are expected verbatim.
  const verbatim = PATTERNS.filter(({ address }) => router.includes(`\`${address}\``));
  assert(verbatim.length >= 17, `only ${verbatim.length} rows read verbatim from the router`);
  const missed = verbatim.filter(({ re }) => [...router.matchAll(re)].length === 0)
    .map((p) => p.address);
  assertEquals(missed, [], "these rows are not matched by their own pattern");
  // …and on every spelling a harness gives an address.
  for (
    const spelling of [
      "run `$specnaut merge` now",
      "use `/specnaut-plugin:specnaut plan`",
      "the `$specnaut-board` skill",
      "invoke specnaut-sec-audit",
      "then `/specnaut-review`",
      "try `/specnaut audit --security`",
    ]
  ) {
    assert(hits("probe", spelling).length > 0, `not caught: ${spelling}`);
  }
  // …and not on a path, nor on the successors.
  for (
    const clean of [
      ".specnaut/addenda/board/groom.md",
      "templates/core/skills/code-audit/SKILL.md",
      "`/task merge`, `$specnaut-task merge`, `/specnaut upgrade`, `/specnaut list`",
    ]
  ) {
    assertEquals(hits("probe", clean), [], `a non-address read as one: ${clean}`);
  }
});

Deno.test("no shipped file names a retired address outside the retired table", async () => {
  const docs = await population();
  // Per source, so a scope root that silently stopped yielding fails alone.
  const counts = new Map<string, number>();
  for (const d of docs) counts.set(d.source, (counts.get(d.source) ?? 0) + 1);
  for (const source of ["bundle", "static", "plugin", "mods", "hooks", "readme", "src"]) {
    assert((counts.get(source) ?? 0) > 0, `the ${source} scan read nothing`);
  }
  const found = docs.flatMap((d) => hits(d.where, d.content));
  assertEquals(
    found,
    [],
    `${found.length} mention(s) of a retired address. Point at the new address — ` +
      `the "Retired addresses" table in templates/core/skills/specnaut/SKILL.md names it — ` +
      `or, if the file's subject IS the move, add it to EXCLUDED with a reason.`,
  );
});

Deno.test("the retired table has one home — /task keeps no copy", () => {
  for (const e of CORE_BUNDLE) {
    if (e.category === "skill" && e.name === "specnaut") continue;
    assertEquals(
      retiredSection(e.content),
      "",
      `${e.category}:${e.name}/${e.suffix ?? ""} carries a second Retired addresses section`,
    );
  }
});

Deno.test("no exclusion excuses a path that no longer exists", () => {
  const stale = EXCLUDED.filter((x) => {
    try {
      Deno.statSync(`${REPO}${x.path}`);
      return false;
    } catch {
      return true;
    }
  }).map((x) => x.path);
  assertEquals(
    stale,
    [],
    "prune them — an exclusion that excuses nothing hides the day it returns",
  );
  for (const x of EXCLUDED) assert(x.reason.trim() !== "", `${x.path} has no reason`);
});

Deno.test("no successor is itself retired — a user is sent straight to a live address", () => {
  // Spec 041 retired `/task tasks` while `/specnaut tasks` still pointed at it: a two-step
  // chain. Read the second column generically, so the next retirement cannot recreate one.
  const retired = new Set(retiredAddresses().map((r) => r.address));
  const successors = retiredSection().split("\n")
    .map((line) => line.match(/^\| `[^`]+`[^|]*\| `([^`]+)`/)?.[1])
    .filter((s): s is string => s !== undefined);
  assert(successors.length >= 10, `read only ${successors.length} successors from the table`);
  const chained = successors.filter((s) => retired.has(s));
  assertEquals(chained, [], "a retired address points at another retired address");
});
