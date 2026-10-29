import { assert, assertEquals } from "@std/assert";
import {
  ADDENDUM_SKILLS,
  auditAddendum,
  CONTRACT_DOCS,
  ROUTABLE_PHASES,
} from "../../src/domain/addendum_audit.ts";
import { SKILL_DOC_RENAMES } from "../../src/domain/skill_doc_renames.ts";
import { docOf, router, verbTable } from "./verb_table.ts";

/**
 * #622 — `ROUTABLE_PHASES` and `CONTRACT_DOCS` are declared in code, once, so
 * `check` validates addenda against the binary's own bundle. These tests are
 * what keeps that declaration from going stale: adding, renaming or demoting a
 * phase doc without touching the constant fails here, not silently in a
 * project whose addendum stops being read.
 *
 * cli#683 split the pipeline off `/specnaut` into `/task`, and `/task` routes
 * one verb (`groom`) to a document outside `phases/`. So a verb's document is
 * read from the router's own verb table rather than assumed to be
 * `phases/<verb>.md`.
 */

const SKILLS_DIR = new URL("../../templates/core/skills/", import.meta.url);

/** The doc names on disk under `templates/core/skills/<skill>/phases/`. */
function phaseDocsOnDisk(skill: string): string[] {
  const names: string[] = [];
  for (const e of Deno.readDirSync(new URL(`${skill}/phases/`, SKILLS_DIR))) {
    if (e.isFile && e.name.endsWith(".md")) names.push(e.name.replace(/\.md$/, ""));
  }
  return names.sort();
}

/**
 * The `phases/<doc>.md` references in the router's table rows, in row order,
 * first mention only — used for `/ship`, whose tables are by path.
 */
function phaseRefOrder(content: string): string[] {
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

Deno.test("the routers that read an addendum are specnaut, task and ship", () => {
  assertEquals([...ADDENDUM_SKILLS], ["specnaut", "task", "ship"]);
  // Non-vacuity for the table parser the tests below lean on: both verb-table
  // routers must yield rows, or every "in the table" check passes on nothing.
  assert(verbTable(router("specnaut")).length >= 3, "read no verb table from /specnaut");
  assert(verbTable(router("task")).length >= 15, "read no verb table from /task");
});

Deno.test("routable phases and contract docs together are exactly each skill's phases/ dir", () => {
  for (const skill of ADDENDUM_SKILLS) {
    const onDisk = phaseDocsOnDisk(skill);
    assert(onDisk.length > 0, `read nothing from templates/core/skills/${skill}/phases/`);
    const inPhases = ROUTABLE_PHASES[skill]
      .filter((v) => docOf(skill, v) === `phases/${v}.md`);
    const declared = [...inPhases, ...contractDocsOf(skill)].sort();
    assertEquals(declared, onDisk, `${skill}: declared phases drifted from the templates`);
  }
});

Deno.test("every routable verb is a row of its router's table, and its document ships", () => {
  for (const skill of ADDENDUM_SKILLS) {
    const rows = verbTable(router(skill)).map((r) => r.verb);
    for (const verb of ROUTABLE_PHASES[skill]) {
      if (rows.length > 0) {
        assert(rows.includes(verb), `${skill}: routable verb "${verb}" has no row in the router`);
      }
      const doc = docOf(skill, verb);
      let onDisk = false;
      try {
        onDisk = Deno.statSync(new URL(`${skill}/${doc}`, SKILLS_DIR)).isFile;
      } catch {
        onDisk = false;
      }
      assert(onDisk, `${skill}: "${verb}" routes to ${doc}, which does not exist`);
    }
  }
});

Deno.test("routable phases are declared in the router's table order", () => {
  for (const skill of ADDENDUM_SKILLS) {
    const rows = verbTable(router(skill)).map((r) => r.verb);
    const routable = new Set(ROUTABLE_PHASES[skill]);
    const tableOrder = rows.length > 0
      ? rows.filter((v) => routable.has(v))
      : phaseRefOrder(router(skill));
    assertEquals(
      [...ROUTABLE_PHASES[skill]],
      tableOrder,
      `${skill}: ROUTABLE_PHASES must follow the router's table — ties are broken by it`,
    );
  }
});

Deno.test("the router's addendum step names exactly the verbs that read one", () => {
  // `/task` is the router whose verbs do not all read an addendum: of its
  // backlog verbs only `groom` does. Its Routing step 2 therefore names the
  // set, and a verb added there and not to `ROUTABLE_PHASES` is an addendum the
  // router reads and `check --project` reports as unknown — or the reverse.
  const content = router("task");
  const step = content.split("\n").findIndex((l) => l.includes(".specnaut/addenda/task/<verb>.md"));
  assert(step !== -1, "the /task router no longer states where its addenda live");
  const paragraph = content.split("\n").slice(step, step + 3).join(" ");
  const sentence = paragraph.slice(0, paragraph.indexOf(" — "));
  const named = [...sentence.matchAll(/`([a-z][a-z-]*)`/g)].map((m) => m[1]).sort();
  assertEquals(named, [...ROUTABLE_PHASES.task].sort());
});

Deno.test("the contract docs are the ones the /task router calls contract docs", () => {
  const marker = "are **contract docs, not verbs**";
  const content = router("task");
  const at = content.indexOf(marker);
  assert(at !== -1, "the router no longer names its contract docs");
  const paragraph = content.slice(content.lastIndexOf("\n\n", at), at);
  const named = [...paragraph.matchAll(/phases\/([a-z0-9-]+)\.md/g)].map((m) => m[1]).sort();
  assert(named.length > 0, "the contract-doc paragraph names no document");
  assertEquals([...contractDocsOf("task")].sort(), named);
  // Since cli#683 the contract docs all live under `/task`; none is left
  // declared against a router that no longer carries it.
  assertEquals(CONTRACT_DOCS.filter((c) => c.skill !== "task"), []);
});

Deno.test("every contract doc's parent is a routable phase", () => {
  for (const c of CONTRACT_DOCS) {
    assert(c.parents.length > 0, `${c.doc} points at no parent`);
    for (const p of c.parents) {
      assert(
        (ROUTABLE_PHASES[p.skill] ?? []).includes(p.phase),
        `${c.doc} → ${p.skill}/${p.phase} is not routable`,
      );
    }
  }
});

Deno.test("an addendum left at a renamed address is pointed somewhere the router reads", () => {
  // A suggestion that is itself invalid would send the user from one unread
  // path to another. Asked through `auditAddendum` — what `check --project`
  // actually runs — rather than by re-deriving its rule from the rename table:
  // a backlog doc leaving `/board` reaches the suggestion through a different
  // branch (unknown skill) than a phase leaving `/specnaut` does.
  assert(SKILL_DOC_RENAMES.length > 0, "the rename table is empty");
  for (const r of SKILL_DOC_RENAMES) {
    const finding = auditAddendum(`${r.from.owner}/${r.from.doc}`);
    assert(finding !== null, `${r.from.owner}/${r.from.doc} was accepted as a live address`);
    const s = finding.suggestion;
    // No suggestion is an honest answer — the finding still says the file is
    // not read. A wrong one is the defect.
    if (s === null) continue;
    assert(
      (ROUTABLE_PHASES[s.skill as keyof typeof ROUTABLE_PHASES] ?? []).includes(s.phase),
      `${r.from.owner}/${r.from.doc} is pointed at ${s.skill}/${s.phase}, which no router reads`,
    );
  }
});
