import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { exists } from "@std/fs";

/**
 * #611 — the addendum seam is documented where a project author looks: the
 * upgrade/preserve docs, with the choice between an addendum and a preserve
 * spelled out, because a seam nobody finds leaves them preserving whole files.
 *
 * The second half guards the examples. Every concrete addendum path any
 * surface prints must name a phase a router actually routes to — an example
 * keyed on a contract doc or a retired phase is a file a reader writes and
 * nothing ever reads, and it fails silently by design (no file, no mention).
 */

const root = fromFileUrl(new URL("../../", import.meta.url));
// CRLF on a Windows checkout (core.autocrlf) must not hide a heading.
const read = async (rel: string) =>
  (await Deno.readTextFile(`${root}${rel}`)).replaceAll("\r\n", "\n");

/** The body of the section opened by `heading`, up to the next heading of the same or higher rank. */
function section(content: string, heading: string): string {
  const start = content.indexOf(`\n${heading}\n`);
  assert(start !== -1, `no "${heading}" section`);
  const rank = heading.match(/^#+/)![0].length;
  const rest = content.slice(start + heading.length + 2);
  const next = rest.search(new RegExp(`\\n#{1,${rank}} `));
  return next === -1 ? rest : rest.slice(0, next);
}

const unwrap = (t: string) => t.replace(/\s*\n\s*/g, " ");

Deno.test("README documents the addendum under upgrading, with when-to-preserve guidance", async () => {
  const upgrading = section(await read("README.md"), "## Upgrading an existing project");
  const addenda = section(upgrading, "### Adding to a bundled phase without preserving it");
  assertStringIncludes(addenda, ".specnaut/addenda/<skill>/<phase>.md");
  const prose = unwrap(addenda);
  // The choice, both sides of it — the AC is guidance, not an announcement.
  assertStringIncludes(prose, "Use an addendum when");
  assertStringIncludes(prose, "A full preserve is still warranted when");
  assertStringIncludes(prose, "`.specnaut/preserve.yml`");
  // Precedence, in the reader's terms.
  assertStringIncludes(prose, "cannot replace or skip a bundled step");
});

Deno.test("UPGRADING announces the phase-addenda block and the way off a preserve", async () => {
  const guide = await read("UPGRADING.md");
  const addenda = section(guide, "### Add to a bundled phase without preserving it");
  const prose = unwrap(addenda);
  assertStringIncludes(prose, "<!-- --- Specnaut: phase-addenda --- -->");
  assertStringIncludes(prose, ".specnaut/addenda/<skill>/<phase>.md");
  // The migration: a project that preserved a phase only to add a line.
  assertStringIncludes(prose, "specnaut diff");
  assertStringIncludes(prose, "preserve.yml");
});

Deno.test("every concrete addendum path shown anywhere names a routable phase", async () => {
  const surfaces = [
    "README.md",
    "UPGRADING.md",
    "templates/core/root/AGENTS.md",
    "templates/core/skills/specnaut/SKILL.md",
    "templates/core/skills/ship/SKILL.md",
  ];
  const router = await read("templates/core/skills/specnaut/SKILL.md");
  // The router names its own contract docs in one paragraph; that list is the
  // authority on what is loaded rather than routed.
  const contractPara = router.slice(
    0,
    router.indexOf("are **contract docs, not routable phases**"),
  );
  const contractDocs = new Set(
    [...contractPara.slice(contractPara.lastIndexOf("\n\n")).matchAll(/`phases\/([a-z-]+)\.md`/g)]
      .map((m) => m[1]),
  );
  assert(
    contractDocs.has("plan-audits") && contractDocs.has("auto-chain"),
    "contract doc list not found",
  );

  const seen: string[] = [];
  const bad: string[] = [];
  for (const rel of surfaces) {
    for (const m of (await read(rel)).matchAll(/\.specnaut\/addenda\/([a-z-]+)\/([a-z-]+)\.md/g)) {
      const [path, skill, phase] = m;
      seen.push(path);
      const doc = `templates/core/skills/${skill}/phases/${phase}.md`;
      if (!(await exists(`${root}${doc}`))) bad.push(`${rel}: ${path} — no ${doc}`);
      else if (skill === "specnaut" && contractDocs.has(phase)) {
        bad.push(`${rel}: ${path} — a contract doc`);
      }
    }
  }
  // Non-vacuity: the docs do show a worked path, or this sweep checked nothing.
  assert(seen.length > 0, "no concrete addendum path found on any surface");
  assertEquals(bad, [], "addendum examples that nothing would ever read");
});
