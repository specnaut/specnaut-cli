import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import {
  ADDENDUM_SKILLS,
  CONTRACT_DOCS,
  ROUTABLE_PHASES,
} from "../../src/domain/addendum_audit.ts";
import { SKILL_DOC_RENAMES } from "../../src/domain/skill_doc_renames.ts";

/**
 * #622 — `ROUTABLE_PHASES` and `CONTRACT_DOCS` are declared in code, once, so
 * `check` validates addenda against the binary's own bundle. These tests are
 * what keeps that declaration from going stale: adding, renaming or demoting a
 * phase doc without touching the constant fails here, not silently in a
 * project whose addendum stops being read.
 */

const PHASES_DIR = new URL("../../templates/core/skills/", import.meta.url);

/** The doc names on disk under `templates/core/skills/<skill>/phases/`. */
function phaseDocsOnDisk(skill: string): string[] {
  const names: string[] = [];
  for (const e of Deno.readDirSync(new URL(`${skill}/phases/`, PHASES_DIR))) {
    if (e.isFile && e.name.endsWith(".md")) names.push(e.name.replace(/\.md$/, ""));
  }
  return names.sort();
}

function router(skill: string): string {
  const e = CORE_BUNDLE.find((x) => x.category === "skill" && x.name === skill);
  if (!e) throw new Error(`no bundled router for ${skill}`);
  return e.content;
}

/**
 * The `phases/<doc>.md` references in the router's table rows, in row order,
 * first mention only — the order ties are broken by.
 */
function tableOrder(content: string): string[] {
  const seen: string[] = [];
  for (const line of content.split("\n")) {
    if (!line.startsWith("|")) continue;
    for (const m of line.matchAll(/phases\/([a-z0-9-]+)\.md/g)) {
      if (!seen.includes(m[1])) seen.push(m[1]);
    }
  }
  return seen;
}

const contractDocsOf = (skill: string) =>
  CONTRACT_DOCS.filter((c) => c.skill === skill).map((c) => c.doc);

Deno.test("routable phases and contract docs together are exactly each skill's phases/ dir", () => {
  assertEquals([...ADDENDUM_SKILLS], ["specnaut", "ship"]);
  for (const skill of ADDENDUM_SKILLS) {
    const onDisk = phaseDocsOnDisk(skill);
    assert(onDisk.length > 0, `read nothing from templates/core/skills/${skill}/phases/`);
    const declared = [...ROUTABLE_PHASES[skill], ...contractDocsOf(skill)].sort();
    assertEquals(declared, onDisk, `${skill}: declared phases drifted from the templates`);
  }
});

Deno.test("routable phases are declared in the router's phase-table order", () => {
  for (const skill of ADDENDUM_SKILLS) {
    assertEquals(
      [...ROUTABLE_PHASES[skill]],
      tableOrder(router(skill)),
      `${skill}: ROUTABLE_PHASES must follow the router's table — ties are broken by it`,
    );
  }
});

Deno.test("the contract docs are the ones the /specnaut router calls contract docs", () => {
  const marker = "are **contract docs, not routable phases**";
  const content = router("specnaut");
  const at = content.indexOf(marker);
  assert(at !== -1, "the router no longer names its contract docs");
  const paragraph = content.slice(content.lastIndexOf("\n\n", at), at);
  const named = [...paragraph.matchAll(/phases\/([a-z0-9-]+)\.md/g)].map((m) => m[1]).sort();
  assertEquals([...contractDocsOf("specnaut")].sort(), named);
});

Deno.test("every contract doc's parent, and every rename target, is a routable phase", () => {
  for (const c of CONTRACT_DOCS) {
    assert(c.parents.length > 0, `${c.doc} points at no parent`);
    for (const p of c.parents) {
      assert(
        (ROUTABLE_PHASES[p.skill] ?? []).includes(p.phase),
        `${c.doc} → ${p.skill}/${p.phase} is not routable`,
      );
    }
  }
  // A suggestion that is itself invalid would send the user from one unread
  // path to another.
  for (const r of SKILL_DOC_RENAMES) {
    const to = r.to.doc.replace(/\.md$/, "");
    assert(
      (ROUTABLE_PHASES[r.to.owner as keyof typeof ROUTABLE_PHASES] ?? []).includes(to),
      `rename target ${r.to.owner}/${to} is not routable`,
    );
  }
});
