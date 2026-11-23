import { assert, assertEquals } from "@std/assert";
import { INSTRUCTION_SCOPE, keptAtHead } from "../../src/domain/instruction_scope.ts";
import { REASON } from "../../src/domain/script_trust.ts";
import { SHORT_NAME_REASON, WIN32_ALIAS_REASON } from "../../src/domain/win32_path.ts";
import { blob, enc, file, judge, walked } from "./instruction_trust_fixture.ts";

/**
 * A name Win32 opens as another: an 8.3 short name of a folder or file on the way to an
 * instruction path, or one ending in a dot or a space, or holding a stream suffix. Each is kept at
 * HEAD and named unless the tip holds it as written: it is never taken for the name it may open.
 */

/** For each root of the class, by its folder: a short name standing for the folder or its file. */
const SHORT_NAMES: Readonly<Record<string, readonly string[]>> = {
  ".": ["MCP~1.JSO", "GITATT~1", "LFSCON~1"],
  ".claude": ["CLAUDE~1/settings.json", "CLAUDE~1/CLAUDE.md", ".claude/SETTIN~1.JSO"],
  ".claude/skills": ["CLAUDE~1/skills/task/SKILL.md"],
  ".claude/agents": ["CLAUDE~1/agents/coder.md"],
  ".claude/hooks": ["CLAUDE~1/hooks/stop.sh"],
  ".claude/commands": ["CLAUDE~1/commands/ship.md"],
  ".claude/rules": ["CLAUDE~1/rules/style.md"],
  ".claude/output-styles": [".claude/OUTPUT~1/terse.md", "CLAUDE~1/output-styles/terse.md"],
  ".codex": ["CODEX~1/config.toml"],
  ".agents": ["AGENTS~1/skills/task/SKILL.md"],
  ".specnaut/hooks": ["SPECNA~1/hooks/pre-merge.sh"],
  ".specnaut/addenda": ["SPECNA~1/addenda/task/merge.md"],
  ".specnaut": [".specnaut/APPROV~1.TXT"],
  "docs": ["docs/CONSTI~1.MD"],
};

/** Each root's file, spelled as Win32 trims it or as a stream of it. */
const ALIASES = [
  "AGENTS.md.",
  "CLAUDE.md ",
  "AGENTS.md::$DATA",
  ".claude./settings.json",
  ".claude /skills/task/SKILL.md",
  ".codex::$DATA/config.toml",
  "docs/constitution.md:notes",
  "AGENTS.override.md.",
];

Deno.test("the short-name table holds a row for every root of the class", () => {
  assertEquals(Object.keys(SHORT_NAMES).sort(), INSTRUCTION_SCOPE.map((r) => r.dir).sort());
});

Deno.test("HEAD's listing keeps a path holding a short name, for every root of the class", () => {
  for (const kept of Object.values(SHORT_NAMES).flat()) assert(keptAtHead(kept), kept);
  assert(!keptAtHead("src/notes~/a.md"));
});

Deno.test("a short name the tip lacks is named, for every root of the class", () => {
  for (const path of Object.values(SHORT_NAMES).flat()) {
    assertEquals(judge({ tree: walked(), tip: [], head: [blob(path)] }), [
      `${path} ${SHORT_NAME_REASON}`,
    ], path);
  }
});

Deno.test("a short name outside the roots that the tip holds as written is judged by its bytes", () => {
  const path = "CLAUDE~1/settings.json";
  const tip = [blob(path)];
  assertEquals(judge({ tree: walked(), tip, head: tip }), ["trusted"]);
  assertEquals(judge({ tree: walked(), tip, head: [blob(path, enc("{}"))] }), [
    `${path} ${REASON.differs}`,
  ]);
});

Deno.test("a short name inside a root that the tip holds as written is judged as any other", () => {
  const path = ".claude/skills/LONGSK~1/SKILL.md";
  const tip = [blob(path)];
  assertEquals(judge({ tree: walked(file(path)), tip, head: tip }), ["trusted"]);
});

Deno.test("HEAD's listing keeps a path Win32 trims or reads as a stream of an instruction path", () => {
  for (const kept of ALIASES) assert(keptAtHead(kept), kept);
});

Deno.test("a path Win32 trims or reads as a stream, that the tip lacks, is named so", () => {
  for (const path of ALIASES) {
    assertEquals(judge({ tree: walked(), tip: [], head: [blob(path)] }), [
      `${path} ${WIN32_ALIAS_REASON}`,
    ], path);
  }
});
