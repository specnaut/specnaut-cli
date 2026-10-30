import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { CONSTITUTION_PATH } from "../../src/domain/constitution_paths.ts";
import { ADDENDUM_SKILLS, ROUTABLE_PHASES } from "../../src/domain/addendum_audit.ts";
import { AGENT_FOLDERS, agentFile } from "../../src/domain/agent_folders.ts";
import { linkTargetPath } from "../../src/domain/context_link.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import type { KnownHarness } from "../../src/domain/installed_lock.ts";
import { extractBlock } from "../../src/domain/merge_block.ts";
import {
  skillDocDestination,
  skillFolderName,
  skillNameFor,
} from "../../src/infrastructure/harness/skill_folder.ts";
import { SKILL_SURFACE } from "../../src/infrastructure/harness/skill_layout.ts";
import { alwaysOnDestinations } from "./always_on.ts";
import {
  agentsMd,
  bodyOf,
  claimsExemption,
  CONSTITUTION_IMPORT,
  CONSTITUTION_REFERENCE,
  constitutionTemplate,
  exemptionReason,
  firstInstruction,
  firstStep,
  importTokens,
  LEADING_LINES,
  secondInstruction,
} from "./constitution_reference.ts";
import { docOf, router, routers, verbTable } from "./verb_table.ts";

/**
 * Every task entry point reads the constitution first (spec 039, specnaut-cli#685).
 *
 * The constitution governs work only if it is in context when the work starts.
 * Each entry point a harness loads — the `AGENTS.md` fence, every router, the
 * document behind every `/task` verb, every agent — opens with one sentence,
 * verbatim. Everything is enumerated FROM THE BUNDLE, so a skill or an agent
 * added tomorrow is held to it without anyone remembering to list it. Position
 * is checked, not presence: a reference after the first step is read after the
 * work it should have shaped.
 */

const OPTS = {
  backlogBackend: "github",
  versionScheme: "semver",
  specBackend: "local",
  specAutogen: false,
} as const;

/** The two harnesses whose emitted files are held to position, not just presence. */
const FRONTIER = ["claude", "codex"];

const agents = () => CORE_BUNDLE.filter((e) => e.category === "agent");

/** The bundle entry behind a `/task` routable verb, through the router's own table. */
function taskDoc(verb: string): CoreEntry {
  const doc = docOf("task", verb).replace(/^phases\//, "");
  const hit = CORE_BUNDLE.find((e) =>
    e.name === "task" && (e.category === "phase" || e.category === "backlog-doc") &&
    e.suffix === doc
  );
  if (!hit) throw new Error(`/task ${verb}: no bundled ${doc}`);
  return hit;
}

/** Every entry point held to the reference, with the lines that precede it (plan 039 § 6). */
function entryPoints(): Array<{ entry: CoreEntry; skip: number }> {
  return [
    ...agents().map((entry) => ({ entry, skip: LEADING_LINES.agent })),
    // Exemptions are read from the SOURCE: Codex rebuilds frontmatter and drops the key.
    ...routers().filter((e) => exemptionReason(e.content) === null)
      .map((entry) => ({ entry, skip: LEADING_LINES.router })),
    ...ROUTABLE_PHASES.task.map((v) => ({ entry: taskDoc(v), skip: LEADING_LINES.verbDoc })),
  ];
}

/**
 * Where `harness` writes `e`, composed from the homes the adapters read
 * (`AGENT_FOLDERS`, `SKILL_SURFACE`). An exact key, never a pattern: a renamed
 * emit path is then a missing file, not a check that matched nothing (cli#706).
 * A harness with no agent folder receives each agent as a skill.
 */
function emittedAt(harness: KnownHarness, e: CoreEntry): string {
  const layout = SKILL_SURFACE[harness].layout;
  if (e.category === "phase" || e.category === "backlog-doc") return skillDocDestination(e, layout);
  const folder = e.category === "agent" ? AGENT_FOLDERS[harness] : null;
  if (folder) return agentFile(folder, e.name);
  const name = e.category === "agent" ? skillFolderName(e) : skillNameFor(e.name, layout);
  return layout.kind === "flat"
    ? `${layout.dir}/${name}${layout.ext}`
    : `${layout.root}/${name}/SKILL.md`;
}

/** The instructions an emitted file carries: a Codex agent's TOML field, else the body. */
const emittedBody = (dest: string, content: string) =>
  dest.endsWith(".toml")
    ? String((parseToml(content) as Record<string, unknown>).developer_instructions ?? "")
    : bodyOf(content);

/** Each entry point as `harness` emits it, or a problem naming the missing destination. */
function emitted(harness: (typeof HARNESSES)[number]) {
  const bundle = harness.mapBundle(CORE_BUNDLE, OPTS);
  return entryPoints().map(({ entry, skip }) => {
    const dest = emittedAt(harness.key as KnownHarness, entry);
    const file = bundle[dest];
    return { dest, skip, body: file ? emittedBody(dest, file.content) : null };
  });
}

Deno.test("every router opens with the reference, or says on the file why it does not", () => {
  const wrong: string[] = [];
  const exempt: string[] = [];
  for (const e of routers()) {
    const reason = exemptionReason(e.content);
    if (reason !== null) {
      exempt.push(`${e.name}: ${reason}`);
      continue;
    }
    if (claimsExemption(e.content)) {
      wrong.push(`${e.name}: constitution-exempt with no reason`);
      continue;
    }
    if (firstStep(e.content, LEADING_LINES.router) !== CONSTITUTION_REFERENCE) wrong.push(e.name);
  }
  assertEquals(wrong, [], "routers whose first instruction is not the reference");
  assert(routers().length > exempt.length, "every router is exempt — the guard checks nothing");
  // The exemptions are on the files; this is where a reviewer sees them all at once.
  console.log(`constitution-exempt (${exempt.length}):\n  ${exempt.join("\n  ")}`);
});

Deno.test("no agent and no task-routing router may opt out", () => {
  const taskRouters = routers().filter((e) =>
    (ADDENDUM_SKILLS as ReadonlyArray<string>).includes(e.name)
  );
  // A renamed router would leave the ban checking agents alone, and a quoted key free (cli#706).
  assertEquals(taskRouters.length, ADDENDUM_SKILLS.length, "a task-routing router is missing");
  const banned = [
    ...agents(),
    ...taskRouters,
  ].filter((e) => claimsExemption(e.content)).map((e) => `${e.category}:${e.name}`);
  assertEquals(banned, [], "entry points that may not be exempt");
});

Deno.test("the document behind every /task routable verb opens with the reference", () => {
  const verbs = ROUTABLE_PHASES.task;
  // The floor is the router's own verb table (cli#709): every verb it routes to a `phases/` doc
  // is checked here, so a verb added there and missed in the declared set fails, not passes.
  const phaseVerbs = verbTable(router("task")).filter((r) => r.doc.startsWith("phases/"));
  assert(phaseVerbs.length > 0, "parsed no `phases/` row from the /task verb table");
  const unchecked = phaseVerbs.map((r) => r.verb).filter((v) => !verbs.includes(v));
  assertEquals(unchecked, [], "/task verbs the router routes to a phase but this test skips");
  const wrong = verbs.filter((v) =>
    firstStep(taskDoc(v).content, LEADING_LINES.verbDoc) !== CONSTITUTION_REFERENCE
  );
  assertEquals(wrong, [], "/task verbs whose document does not open with the reference");
});

Deno.test("every agent's body opens with the reference", () => {
  assert(agents().length > 0, "no agents in the bundle");
  const wrong = agents()
    .filter((e) => firstStep(e.content, LEADING_LINES.agent) !== CONSTITUTION_REFERENCE)
    .map((e) => e.name);
  assertEquals(wrong, [], "agents whose first instruction is not the reference");
});

Deno.test("Claude and Codex emit every agent, router and /task verb document reference-first", () => {
  const wrong: string[] = [];
  for (const key of FRONTIER) {
    const harness = HARNESSES.find((h) => h.key === key);
    assert(harness, `no ${key} harness`);
    for (const { dest, skip, body } of emitted(harness)) {
      if (body === null) wrong.push(`${key}: ${dest} not emitted`);
      else if (firstInstruction(body, skip) !== CONSTITUTION_REFERENCE) {
        wrong.push(`${key}: ${dest}`);
      }
    }
  }
  assertEquals(wrong, [], "emitted entry points that do not open with the reference");
});

Deno.test("every other harness still carries the reference in each emitted entry point", () => {
  // Frontier harnesses decide the shape; the others follow (2026-10-28). Their
  // adapters may rebuild a file around the body, so presence is what is held —
  // at the exact destination, so a path that moved fails instead of matching nothing.
  const missing: string[] = [];
  const others = HARNESSES.filter((h) => !FRONTIER.includes(h.key));
  assert(others.length > 0, "no non-frontier harness to check");
  for (const harness of others) {
    for (const { dest, body } of emitted(harness)) {
      if (body === null) missing.push(`${harness.key}: ${dest} not emitted`);
      else if (!body.includes(CONSTITUTION_REFERENCE)) missing.push(`${harness.key}: ${dest}`);
    }
  }
  assertEquals(missing, [], "emitted entry points with no reference at all");
});

Deno.test("the AGENTS.md constitution fence opens with the reference, then the import", () => {
  const fence = extractBlock(agentsMd().content, "constitution", "html");
  assert(fence, "no constitution fence in AGENTS.md");
  const skip = LEADING_LINES.fence;
  assertEquals(firstInstruction(fence!, skip), CONSTITUTION_REFERENCE, "fence: first instruction");
  assertEquals(secondInstruction(fence!, skip), CONSTITUTION_IMPORT, "fence: the import line");
});

Deno.test("the scaffolded AGENTS.md leads with the constitution, not with itself", () => {
  const text = agentsMd().content;
  const fenceAt = text.indexOf("<!-- --- Specnaut: constitution --- -->");
  const firstH2 = text.search(/^## /m);
  assert(fenceAt >= 0 && fenceAt < firstH2, "the constitution fence is not the first section");
  const header = text.slice(0, fenceAt);
  assert(
    !/source of truth/i.test(header),
    "the header still calls AGENTS.md the source of truth — the constitution is",
  );
});

Deno.test("the only import Claude Code would follow is the constitution's own", () => {
  // Claude Code follows every `@path` in a loaded file, nested five deep, with
  // no prompt for an in-repo target (plan 039 § 11). The always-on file and the
  // file it imports carry exactly one, and the constitution imports nothing.
  assertEquals(importTokens(agentsMd().content), [CONSTITUTION_IMPORT], "AGENTS.md import tokens");
  assertEquals(
    importTokens(constitutionTemplate().content),
    [],
    "the constitution template imports nothing",
  );
});

Deno.test("no always-on file of any harness imports anything but the constitution", async () => {
  // Every `alwaysOn` entry, not two named files: a harness that loads a file in
  // every session follows its imports too. A context link loads the file it
  // points at; its fallback, written where links are refused, imports exactly that.
  const alwaysOn = await alwaysOnDestinations();
  assert(alwaysOn.size > 0, "no alwaysOn entries at all — the scan would check nothing");
  const stray: string[] = [];
  const scan = (at: string, text: string, allowed: string) =>
    importTokens(text).filter((t) => t !== allowed).forEach((t) => stray.push(`${at}: ${t}`));
  for (const [key, dests] of alwaysOn) {
    const bundle = HARNESSES.find((h) => h.key === key)?.mapBundle(CORE_BUNDLE, OPTS) ?? {};
    for (const dest of dests) {
      const file = HARNESS_STATIC[key]?.[dest];
      if (!file) {
        stray.push(`${key}:${dest} not in HARNESS_STATIC`);
        continue;
      }
      if (file.symlinkTo === undefined) {
        scan(`${key}:${dest}`, file.content, CONSTITUTION_IMPORT);
        continue;
      }
      scan(`${key}:${dest} (fallback)`, file.content, `@${file.symlinkTo}`);
      const target = linkTargetPath(dest, file.symlinkTo);
      if (!bundle[target]) stray.push(`${key}:${dest} links to ${target}, which is not emitted`);
      else scan(`${key}:${target}`, bundle[target].content, CONSTITUTION_IMPORT);
    }
  }
  assertEquals(stray, [], "always-on files importing something else");
});

Deno.test("the constitution path is relative and stays inside the project", () => {
  assert(
    !CONSTITUTION_PATH.startsWith("/") && !CONSTITUTION_PATH.startsWith("~"),
    CONSTITUTION_PATH,
  );
  assert(!CONSTITUTION_PATH.split("/").includes(".."), CONSTITUTION_PATH);
});
