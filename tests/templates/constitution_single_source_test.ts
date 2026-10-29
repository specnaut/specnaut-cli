import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { CONSTITUTION_PATH } from "../../src/domain/constitution_paths.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import { extractBlock } from "../../src/domain/merge_block.ts";
import { managedSectionLabels } from "../../src/domain/template.ts";

/**
 * One constitution source (spec 038, FR-001–FR-004).
 *
 * The bootstrap is the team's document from the moment it lands: one source in
 * the bundle, written once to `docs/constitution.md`, never a second copy under
 * a harness tree where an agent would read a stale twin. And it reads as a plain
 * team document — a Specnaut name in it would be the framework writing itself
 * into a file it promises never to touch again (FR-002).
 */

const OPTS = {
  backlogBackend: "local",
  versionScheme: "semver",
  specBackend: "local",
  specAutogen: false,
} as const;

function bootstrap(): CoreEntry {
  const hits = CORE_BUNDLE.filter((e) =>
    e.category === "project-root" && e.suffix === CONSTITUTION_PATH
  );
  assertEquals(hits.length, 1, "exactly one bootstrap entry");
  return hits[0];
}

/** Every bundled dest of every harness, with its content. */
function allDests(): Array<{ harness: string; dest: string; content: string }> {
  return HARNESSES.flatMap((h) =>
    Object.entries(h.mapBundle(CORE_BUNDLE, OPTS)).map(([dest, f]) => ({
      harness: h.key,
      dest,
      content: f.content,
    }))
  );
}

const checkLines = (text: string) =>
  text.replaceAll("\r\n", "\n").split("\n").filter((l) => l.startsWith("Check:"));

Deno.test("the bootstrap is the one project-owned constitution source", () => {
  const entry = bootstrap();
  assertEquals(entry.projectOwned, true, "projectOwned");
  const sources = CORE_BUNDLE.filter((e) =>
    /(^|\/)constitution\.md$/.test(e.suffix ?? "") && e.category !== "phase"
  );
  assertEquals(sources.map((e) => e.suffix), [CONSTITUTION_PATH]);
});

Deno.test("the bootstrap carries four principles, each with a Check: line, in ≤ 60 lines", () => {
  const text = bootstrap().content.replaceAll("\r\n", "\n");
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  assert(lines.length <= 60, `${lines.length} lines`);
  const sections = text.split(/^## /m).slice(1);
  assertEquals(sections.length, 4, "four ## principles");
  for (const s of sections) {
    const name = s.split("\n")[0];
    assert(checkLines(s).length >= 1, `${name}: no Check: line`);
    assert(/^Override:/m.test(s), `${name}: no override note`);
  }
  assert(/^Version: 1\.0\.0$/m.test(text), "Version: 1.0.0 footer");
});

Deno.test("each Check: line lives in the bootstrap only", () => {
  const checks = checkLines(bootstrap().content);
  assert(checks.length >= 4);
  for (const check of checks) {
    const homes = CORE_BUNDLE.filter((e) => e.content.includes(check));
    assertEquals(homes.length, 1, `${check} is in ${homes.length} entries`);
  }
});

Deno.test("the bootstrap names no Specnaut skill, agent or command, and carries no marker (FR-002)", () => {
  const text = bootstrap().content;
  const names = new Set(
    CORE_BUNDLE.filter((e) =>
      e.category === "skill" || e.category === "agent" ||
      e.category === "phase"
    ).map((e) => e.name),
  );
  const problems: string[] = [];
  for (const name of names) {
    // A plain English word (`task`, `ship`, `developer`) is banned as a name only.
    const re = name.includes("-") || name === "specnaut"
      ? new RegExp(`\\b${name}\\b`, "i")
      : new RegExp(`(^|[\\s\`(])/${name}\\b|\`${name}\``, "i");
    if (re.test(text)) problems.push(name);
  }
  if (/specnaut/i.test(text)) problems.push("Specnaut");
  if (/(^|[\s`(])\/[a-z]/m.test(text)) problems.push("a slash command");
  if (text.includes("<!--")) problems.push("an HTML comment");
  if (/\b(BEGIN|END): /.test(text)) problems.push("a conditional marker");
  assertEquals(problems, []);
});

Deno.test("no harness writes a constitution anywhere else, nor a copy under .claude/ or .codex/", () => {
  // The phase helper (`<skills>/task/phases/constitution.md`) is the amendment
  // procedure, not a constitution.
  const allowed = (dest: string) =>
    dest === CONSTITUTION_PATH || /[/-]task\/phases\/constitution\.md$/.test(dest);
  const body = bootstrap().content;
  const problems: string[] = [];
  for (const { harness, dest, content } of allDests()) {
    if (/(^|\/)constitution(-template)?\.md$/.test(dest) && !allowed(dest)) {
      problems.push(`${harness}: ${dest}`);
    }
    if (/^\.(claude|codex)\//.test(dest) && content === body) problems.push(`${harness}: ${dest}`);
  }
  assertEquals(problems, []);
});

Deno.test("every harness writes the bootstrap verbatim at docs/constitution.md, never rewritten", () => {
  const body = bootstrap().content;
  for (const h of HARNESSES) {
    const file = h.mapBundle(CORE_BUNDLE, OPTS)[CONSTITUTION_PATH];
    assert(file !== undefined, `${h.key} does not write ${CONSTITUTION_PATH}`);
    assertEquals(file.content, body, `${h.key} renders the bootstrap`);
    assertEquals(file.projectOwned, true, `${h.key} drops projectOwned`);
    assertEquals(file.skipIfExists, true, `${h.key}: projectOwned implies skipIfExists`);
  }
});

Deno.test("AGENTS.md points at the constitution in its own managed section (FR-005)", () => {
  const agents = CORE_BUNDLE.find((e) => e.category === "project-root" && e.suffix === "AGENTS.md");
  assert(agents !== undefined);
  assert(managedSectionLabels(agents.managedSection).includes("constitution"));
  const body = (extractBlock(agents.content, "constitution", "html") ?? "").replace(/\s+/g, " ");
  assert(body.includes(`\`${CONSTITUTION_PATH}\``), "points at the file");
  assert(body.includes("no agent edits it on its own initiative"), "never self-amended");
  assert(body.includes("stop and ask"), "a conflict is a stop with a question");
});
