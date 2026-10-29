import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { HARNESSES } from "../../src/cli/harnesses.ts";
import { CONSTITUTION_PATH } from "../../src/domain/constitution_paths.ts";
import { ADDENDUM_SKILLS, ROUTABLE_PHASES } from "../../src/domain/addendum_audit.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import { extractBlock } from "../../src/domain/merge_block.ts";
import {
  bodyOf,
  claimsExemption,
  CONSTITUTION_IMPORT,
  CONSTITUTION_REFERENCE,
  exemptionReason,
  firstInstruction,
  firstStep,
  importTokens,
  secondInstruction,
} from "./constitution_reference.ts";
import { docOf } from "./verb_table.ts";

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

const routers = () =>
  CORE_BUNDLE.filter((e) => e.category === "skill" || e.category === "backlog-skill");
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

function agentsMd(): string {
  const root = CORE_BUNDLE.find((e) => e.category === "project-root" && e.suffix === "AGENTS.md");
  assert(root, "no project-root AGENTS.md entry");
  return root!.content;
}

function constitutionTemplate(): string {
  const e = CORE_BUNDLE.find((x) =>
    x.category === "project-root" && x.suffix === CONSTITUTION_PATH
  );
  assert(e, "no bundled constitution template");
  return e!.content;
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
    if (firstStep(e.content) !== CONSTITUTION_REFERENCE) wrong.push(e.name);
  }
  assertEquals(wrong, [], "routers whose first instruction is not the reference");
  assert(routers().length > exempt.length, "every router is exempt — the guard checks nothing");
  // The exemptions are on the files; this is where a reviewer sees them all at once.
  console.log(`constitution-exempt (${exempt.length}):\n  ${exempt.join("\n  ")}`);
});

Deno.test("no agent and no task-routing router may opt out", () => {
  const banned = [
    ...agents(),
    ...routers().filter((e) => (ADDENDUM_SKILLS as ReadonlyArray<string>).includes(e.name)),
  ].filter((e) => claimsExemption(e.content)).map((e) => `${e.category}:${e.name}`);
  assertEquals(banned, [], "entry points that may not be exempt");
});

Deno.test("the document behind every /task routable verb opens with the reference", () => {
  const verbs = ROUTABLE_PHASES.task;
  assert(verbs.length > 0, "read no routable /task verbs");
  const wrong = verbs.filter((v) => firstStep(taskDoc(v).content) !== CONSTITUTION_REFERENCE);
  assertEquals(wrong, [], "/task verbs whose document does not open with the reference");
});

Deno.test("every agent's body opens with the reference", () => {
  assert(agents().length > 0, "no agents in the bundle");
  const wrong = agents()
    .filter((e) => firstInstruction(bodyOf(e.content)) !== CONSTITUTION_REFERENCE)
    .map((e) => e.name);
  assertEquals(wrong, [], "agents whose first instruction is not the reference");
});

Deno.test("Claude and Codex emit every agent with the reference first", () => {
  const wrong: string[] = [];
  for (const key of FRONTIER) {
    const harness = HARNESSES.find((h) => h.key === key);
    assert(harness, `no ${key} harness`);
    const bundle = harness!.mapBundle(CORE_BUNDLE, OPTS);
    for (const a of agents()) {
      const dest = key === "codex" ? `.codex/agents/${a.name}.toml` : `.claude/agents/${a.name}.md`;
      const file = bundle[dest];
      if (!file) {
        wrong.push(`${key}: ${dest} not emitted`);
        continue;
      }
      const body = key === "codex"
        ? String((parseToml(file.content) as Record<string, unknown>).developer_instructions ?? "")
        : bodyOf(file.content);
      if (firstInstruction(body) !== CONSTITUTION_REFERENCE) wrong.push(`${key}: ${dest}`);
    }
  }
  assertEquals(wrong, [], "emitted agents that do not open with the reference");
});

Deno.test("every other harness still carries the reference in each emitted agent", () => {
  // Frontier harnesses decide the shape; the others follow (2026-10-28). Their
  // adapters may rebuild a file around the body, so presence is what is held.
  const missing: string[] = [];
  for (const harness of HARNESSES.filter((h) => !FRONTIER.includes(h.key))) {
    const bundle = harness.mapBundle(CORE_BUNDLE, OPTS);
    for (const a of agents()) {
      const hits = Object.entries(bundle).filter(([dest]) =>
        new RegExp(`(^|[/-])${a.name}(\\.|/SKILL\\.md$)`).test(dest) && !dest.includes("/memory/")
      );
      if (hits.length === 0) continue;
      if (!hits.some(([, f]) => f.content.includes(CONSTITUTION_REFERENCE))) {
        missing.push(`${harness.key}:${a.name}`);
      }
    }
  }
  assertEquals(missing, [], "emitted agents with no reference at all");
});

Deno.test("the AGENTS.md constitution fence opens with the reference, then the import", () => {
  const fence = extractBlock(agentsMd(), "constitution", "html");
  assert(fence, "no constitution fence in AGENTS.md");
  assertEquals(firstInstruction(fence!, 2), CONSTITUTION_REFERENCE, "fence: first instruction");
  assertEquals(secondInstruction(fence!, 2), CONSTITUTION_IMPORT, "fence: the import line");
});

Deno.test("the scaffolded AGENTS.md leads with the constitution, not with itself", () => {
  const text = agentsMd();
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
  assertEquals(importTokens(agentsMd()), [CONSTITUTION_IMPORT], "AGENTS.md import tokens");
  assertEquals(
    importTokens(constitutionTemplate()),
    [],
    "the constitution template imports nothing",
  );
});

Deno.test("the constitution path is relative and stays inside the project", () => {
  assert(
    !CONSTITUTION_PATH.startsWith("/") && !CONSTITUTION_PATH.startsWith("~"),
    CONSTITUTION_PATH,
  );
  assert(!CONSTITUTION_PATH.split("/").includes(".."), CONSTITUTION_PATH);
});
