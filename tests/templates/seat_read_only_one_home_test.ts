import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * #758: the read-only paragraph four review seats share is written once, in
 * `review-findings-contract`, which every one of them already preloads. Each
 * seat keeps its `Read-only contract` heading, one inline clause with a pointer
 * at the skill, and the one sentence that is its own. A second copy of the shared rule would drift
 * from the first at the next edit, and the seats would follow different rules.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
// A Windows checkout reads CRLF; the section pattern is written in LF.
const read = async (p: string) => (await Deno.readTextFile(join(ROOT, p))).replaceAll("\r\n", "\n");
const flat = (s: string) => s.replace(/\s+/g, " ");

const CONTRACT = "templates/core/skills/review-findings-contract/SKILL.md";
const SHARED =
  "No Edit, Write, NotebookEdit or any mutating tool, and no shell: Glob and Grep find " +
  "files, Read reads them. What only a command can tell you reaches you in the brief " +
  "(`phases/review-seats.md` § A brief carries data, never content); what the brief does not " +
  "hold, downgrade to `Suspicion —` and name what would settle it.";
/** Fragments of the shared rule: any one of them in an agent file is a second copy. */
const SHARED_FRAGMENTS = ["NotebookEdit or any mutating tool", "name what would settle it"];
/**
 * The one clause each seat keeps inline: the Codex renderer drops `skills:`, so a
 * seat there reads this line even when it never opens the skill.
 */
const POINTER = "Read-only: no mutating tool, no shell — " +
  "`review-findings-contract` § Read-only contract binds this seat.";

/** seat -> the sentence that stays in its own file. */
const OWN_SENTENCE = new Map<string, string>([
  [
    "architect-expert",
    "A cycle is traced through the imports you read; a module graph you cannot read whole is a " +
    "suspicion, not a finding.",
  ],
  ["performance-expert", "Dependencies come from the manifests and lockfiles you read."],
  [
    "accessibility-expert",
    "Live browser testing and mobile-native semantics are out of scope — name them as runtime " +
    "coverage to add, not as findings.",
  ],
  [
    "dependency-expert",
    "Versions, licenses and the dependency tree come from the manifests and lockfiles you read. " +
    "**Never a live advisory or CVE lookup**: name an advisory scanner for the ecosystem as " +
    "recommended follow-up tooling instead.",
  ],
]);

/** The section under `### Read-only contract`, up to the next heading. */
function section(md: string): string {
  const m = /^### Read-only contract \(NON-NEGOTIABLE\)\n([\s\S]*?)(?=^#{1,3} )/m.exec(md);
  return m ? flat(m[1]).trim() : "";
}

Deno.test("review-findings-contract is the one home of the seats' read-only rule", async () => {
  const body = flat(await read(CONTRACT));
  assert(body.includes("## Read-only contract (NON-NEGOTIABLE)"), "the section heading");
  assert(body.includes(SHARED), "the shared paragraph, verbatim");
});

for (const dir of ["templates/core/agents", "plugin/agents"]) {
  for (const [seat, own] of OWN_SENTENCE) {
    Deno.test(`${dir}/${seat}.md points at the shared rule and keeps only its own sentence`, async () => {
      const text = section(await read(`${dir}/${seat}.md`));
      assertEquals(text, `${POINTER} ${own}`);
    });
  }

  /** The population is the directory: a seat added later cannot bring a copy back. */
  Deno.test(`no agent file under ${dir} carries a copy of the shared rule`, async () => {
    const copies: string[] = [];
    let seen = 0;
    for await (const e of Deno.readDir(join(ROOT, dir))) {
      if (!e.isFile || !e.name.endsWith(".md")) continue;
      seen++;
      const md = flat(await read(`${dir}/${e.name}`));
      for (const f of SHARED_FRAGMENTS) if (md.includes(f)) copies.push(`${e.name}: ${f}`);
    }
    assert(seen >= 8, `found ${seen} agent files; the sweep stopped looking`);
    assertEquals(copies, [], "the shared read-only rule lives in review-findings-contract only");
  });
}
