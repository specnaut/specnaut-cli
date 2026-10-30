import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { CodexHarness } from "../../src/infrastructure/harness/codex_harness.ts";
import { extractBlock } from "../../src/domain/merge_block.ts";

/**
 * Codex delegates only when an instruction names the agent (cli#681): it has no
 * config key that forces delegation. So every agent a delegating step names —
 * in the AGENTS.md dispatch table, and in any "dispatch/spawn the `x`" a
 * shipped skill or agent says — must be the `name` of a scaffolded
 * `.codex/agents/*.toml`. Codex keys agents on that field, not the filename.
 *
 * #678 changes the roster and #683 moves the steps: whichever lands later
 * carries these names along, and this test is what catches the one left out.
 */

const bundle = new CodexHarness().mapBundle(CORE_BUNDLE, {
  backlogBackend: "local",
  versionScheme: "semver",
  specBackend: "local",
  specAutogen: false,
});

const tomlNames = new Set(
  Object.entries(bundle)
    .filter(([dest]) => /^\.codex\/agents\/[^/]+\.toml$/.test(dest))
    .map(([, f]) => String((parseToml(f.content) as { name?: unknown }).name)),
);

/** Every backticked agent in the second column of the dispatch table. */
function tableNames(): string[] {
  const body = extractBlock(bundle["AGENTS.md"]?.content ?? "", "agent-dispatch", "html") ?? "";
  return body.split("\n")
    .filter((l) => /^\|/.test(l) && !/^\|\s*:?-/.test(l))
    .slice(1) // the header row
    .flatMap((l) => [...(l.split("|")[2] ?? "").matchAll(/`([a-z][a-z0-9-]*)`/g)].map((m) => m[1]));
}

/** "Dispatch the `x`", "spawn `x`", "invoke the **`x`**" — a delegation, by any of the three verbs. */
const DELEGATION =
  /\b(?:[Dd]ispatch(?:es|ed|ing)?|[Ss]pawn(?:s|ed|ing)?|[Ii]nvok(?:e|es|ed|ing))\s+(?:the\s+)?\*{0,2}`([a-z][a-z0-9-]*)`/g;

/**
 * A phase is invoked by the same words as an agent — "invoke `review`" — and
 * is no agent: the names of the phase documents a bundle ships are excluded.
 */
const PHASES = new Set(
  Object.keys(bundle).flatMap((dest) => dest.match(/\/phases\/([a-z0-9-]+)\.md$/)?.slice(1) ?? []),
);

/** The agents `text` delegates to by name. */
function delegatedNames(text: string): string[] {
  return [...text.matchAll(DELEGATION)].map((m) => m[1]).filter((name) => !PHASES.has(name));
}

Deno.test("Codex scaffolds the agents it is told to delegate to", () => {
  assert(tomlNames.size > 0, "no .codex/agents/*.toml emitted — the oracle reads nothing");
});

Deno.test("the extractor reads every delegating verb, and no phase as an agent", () => {
  assert(PHASES.has("review") && PHASES.has("merge"), [...PHASES].join(", "));
  assertEquals(
    delegatedNames(
      "Dispatch the `security-expert`. Spawn `code-reviewer`. Invoke the **`product-owner`**; " +
        "it invokes `architect-expert`. Then invoke `review`.",
    ),
    ["security-expert", "code-reviewer", "product-owner", "architect-expert"],
  );
});

Deno.test("the dispatch table names an agent for every delegating step, each one scaffolded", () => {
  const names = tableNames();
  // Every step the AC names: each review seat, the plan audits, every backlog write.
  for (
    const required of [
      "architect-expert",
      "security-expert",
      "code-reviewer",
      "accessibility-expert",
      "dependency-expert",
      "performance-expert",
      "product-owner",
    ]
  ) {
    assert(names.includes(required), `the dispatch table does not name \`${required}\``);
  }
  assertEquals(names.filter((n) => !tomlNames.has(n)), [], "named, but no .codex/agents TOML");
});

Deno.test("every agent a shipped skill or agent delegates to by name is scaffolded", () => {
  const unknown: string[] = [];
  let found = 0;
  for (const [dest, file] of Object.entries(bundle)) {
    if (!/\.(md|toml)$/.test(dest)) continue;
    for (const name of delegatedNames(file.content)) {
      found++;
      if (!tomlNames.has(name)) unknown.push(`${dest}: \`${name}\``);
    }
  }
  assert(found >= 5, `only ${found} delegations found — the extractor is not reading`);
  assertEquals(unknown, [], "delegated to by name, but no .codex/agents TOML");
});
