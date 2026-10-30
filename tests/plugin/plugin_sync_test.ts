import { assertEquals, assertGreaterOrEqual } from "@std/assert";
import { fromFileUrl, relative } from "@std/path";
import { walk } from "@std/fs";

/**
 * Plugin → source-of-truth byte-identical contract.
 *
 * Each row maps a plugin asset to its bundled source. The plugin must be
 * a verbatim copy: any divergence breaks the user-visible UX guarantee
 * that `specnaut init`-scaffolded commands and the plugin-installed
 * versions behave identically. `plugin/skills/` and `plugin/agents/` are
 * excluded from `deno fmt` (see deno.json) so this contract holds
 * against rewraps.
 */
const SYNC_PAIRS: ReadonlyArray<{ plugin: string; source: string }> = [
  // The /specnaut router (v1.0.0). Since cli#683 it carries only the
  // framework verbs — `doc`, `list`, `upgrade` — and the one "Retired
  // addresses" table; the pipeline moved to /task.
  {
    plugin: "plugin/skills/specnaut/SKILL.md",
    source: "templates/core/skills/specnaut/SKILL.md",
  },
  ...["doc", "list", "upgrade"].map((name) => ({
    plugin: `plugin/skills/specnaut/phases/${name}.md`,
    source: `templates/core/skills/specnaut/phases/${name}.md`,
  })),
  // The /task router (cli#683) — the former `board` skill plus the pipeline
  // taken from /specnaut and the audits merged from `code-audit` and the five
  // `*-audit` skills. Its phase and contract docs moved byte-for-byte from
  // `specnaut/phases/` (only addresses changed), so they keep the one channel
  // they had: every one is a mirror. `auto-chain`, `remote-gates`,
  // `orphan-specs`, `epic-*`, `merge-*` and `quality-gates` are contract docs,
  // not verbs — synced all the same, because the router loads them on demand.
  ...[
    "plan",
    "implement",
    "review",
    "review-seats",
    "merge",
    "audit",
    "constitution",
    "auto-chain",
    "remote-gates",
    "orphan-specs",
    "epic-commits",
    "epic-fixups",
    "epic-loop",
    "merge-close",
    "merge-squash",
    "quality-gates",
  ].map((name) => ({
    plugin: `plugin/skills/task/phases/${name}.md`,
    source: `templates/core/skills/task/phases/${name}.md`,
  })),
  // The /ship skill — release concerns left /specnaut in spec 033. It owns its
  // documents the way /task owns groom.md: the owner is the entry's `name`,
  // the document its `suffix`.
  {
    plugin: "plugin/skills/ship/SKILL.md",
    source: "templates/core/skills/ship/SKILL.md",
  },
  ...["tag", "release"].map((name) => ({
    plugin: `plugin/skills/ship/phases/${name}.md`,
    source: `templates/core/skills/ship/phases/${name}.md`,
  })),
  // Machine-readable output-contract skills (#378). `user-invocable:
  // false` — never user-invoked; preloaded into agent context via the
  // `skills:` frontmatter to normalize the WORKFLOW STATUS / REVIEW SUMMARY
  // blocks agents emit after their prose (#678 retired HANDOFF and QA SUMMARY,
  // which nothing parsed).
  ...[
    "workflow-contract",
    "review-findings-contract",
    // #562: sections split out of seats that had no duplication left to
    // reclaim. Same mechanism, same `user-invocable: false`.
    "backlog-frontmatter",
    "specnaut-facts",
    // Also found by the completeness sweep, and also already identical. #547
    // is the reason its own basename could not have caught this: every skill
    // file is named SKILL.md, so the token that identifies it is the runtime
    // path, not the name.
    "backlog-reference-contract",
    // #576. Same shape, same reason: one authored contract, referenced by
    // pointer from every surface that must honour it, restated by none.
    "mobile-first-contract",
    // #575. The third of these, and the first that is in force on EVERY turn
    // rather than on a topic — so it is reached by the always-on leg and the
    // AGENTS.md fence, never by a per-seat `skills:` enumeration.
    "response-style-contract",
    // #381: the read-only session-health report over the status ledger.
    "status-audit",
  ].map((name) => ({
    plugin: `plugin/skills/${name}/SKILL.md`,
    source: `templates/core/skills/${name}/SKILL.md`,
  })),
  // specnaut-facts' on-demand integrations reference, which AGENTS.md points at (cli#679).
  {
    plugin: "plugin/skills/specnaut-facts/integrations.md",
    source: "templates/core/skills/specnaut-facts/integrations.md",
  },
  // /design (#678) — the former ui-ux-designer agent, a user-invoked skill.
  { plugin: "plugin/skills/design/SKILL.md", source: "templates/core/skills/design/SKILL.md" },
  // Dual-copy agents, each landing as `plugin/agents/<name>.md`. Claude Code
  // resolves agents by file basename in plugin scope; no namespacing needed
  // (agents are not user-invokable like slash commands). 15 by #322; #678
  // retired six (ui-ux-designer became /design above) = 9.
  ...[
    "code-reviewer",
    "developer",
    "product-owner",
    "security-expert",
    "specnaut-guide",
    "performance-expert",
    "accessibility-expert",
    "architect-expert",
    "dependency-expert",
  ].map((name) => ({
    plugin: `plugin/agents/${name}.md`,
    source: `templates/core/agents/${name}.md`,
  })),
  // Agent-fleet README documenting the per-agent `effort` rubric (#382).
  // Ships beside the agent files at `.claude/agents/README.md`; mirrored
  // into the plugin through the same byte-identical channel.
  {
    plugin: "plugin/agents/README.md",
    source: "templates/core/agents/README.md",
  },
  // The `task` skill's own documents — the router, the backlog verbs and the
  // grooming docs (#571, carried over from `board` in cli#683). `board` was
  // never in the plugin at all, while EIGHT plugin assets dispatched to it:
  // installing the plugin gave you agents pointing at a skill that was not
  // there. The same guard now holds for its successor.
  //
  // Its `scripts/` are deliberately NOT mirrored, and that is not a
  // preference. They are backend-filtered at init and land FLATTENED at
  // `.specnaut/scripts/backlog/<name>.sh`, and `_config.sh` resolves
  // `ROOT="$(dirname "$0")/../../.."` from that flattened destination. Under
  // `plugin/skills/task/scripts/github/` those three levels land inside the
  // plugin, so every script would resolve a `CONFIG` that cannot exist — 46
  // broken files rather than a working backend. The audit scope collector
  // (`scripts/collect-audit-scope.sh`) is excluded under the same rule. The
  // skill's own text points at the project's installed `.specnaut/scripts/`,
  // so the documents are self-sufficient without them.
  ...[
    "SKILL.md",
    "backlog.md",
    "groom.md",
    "groom-report.md",
    "spec-autogen.md",
  ].map((name) => ({
    plugin: `plugin/skills/task/${name}`,
    source: `templates/core/skills/task/${name}`,
  })),
];

function abs(rel: string): string {
  return fromFileUrl(new URL(`../../${rel}`, import.meta.url));
}

for (const pair of SYNC_PAIRS) {
  Deno.test(`${pair.plugin} is byte-identical to ${pair.source}`, async () => {
    const [plugin, source] = await Promise.all([
      Deno.readTextFile(abs(pair.plugin)),
      Deno.readTextFile(abs(pair.source)),
    ]);
    assertEquals(
      plugin,
      source,
      `Plugin copy of ${pair.plugin} has drifted from ${pair.source}. ` +
        `Either: (a) re-copy the source over the plugin file, ` +
        `or (b) if the divergence is intentional, drop this pair from SYNC_PAIRS and document why.`,
    );
  });
}

// ─── The completeness sweep ─────────────────────────────────────────────
//
// SYNC_PAIRS asserts that every listed pair is byte-identical. Nothing asserted
// that the list COVERS `plugin/`, so an asset added without a row was governed
// by nothing and the suite stayed green — a coverage map measuring its own
// claims rather than its tree. Measured when this landed: 65 Markdown assets,
// 56 pairs, 9 covered by nothing, eight of the nine genuine mirrors that
// happened to be byte-identical. Correct by luck, not by guard.
//
// The population is EVERY file under `plugin/`, and the reason that is not a
// glob lives in `mirror-exclusions.txt`'s header.

const EXCLUSIONS_FILE = "tests/plugin/mirror-exclusions.txt";

/**
 * Repo-relative POSIX path. `relative()` answers in the HOST's separator, so on
 * Windows it returns `plugin\\README.md` while every literal in `SYNC_PAIRS`
 * and in the exclusion list is `/`-separated — which made all 69 assets fall
 * through as uncovered and turned `cross-smoke (windows-latest)` red on `main`
 * while ubuntu, macos and lint-test all passed. The three green legs are why it
 * was invisible locally.
 */
function posix(rel: string): string {
  return rel.replaceAll("\\", "/");
}

/** One exclusion entry: a path, and the written reason that makes it one. */
function readExclusions(text?: string): Map<string, string> {
  const out = new Map<string, string>();
  const raw = text ?? Deno.readTextFileSync(abs(EXCLUSIONS_FILE));
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^(\S+)\s+(.*)$/);
    // An entry with no written reason is NOT an entry. Deliberately dropped
    // rather than reported here: the sweep below then names the file as
    // uncovered, which is the right verdict and the right message. This is the
    // same refusal `scripts/smoke/coverage-allowlist.txt` applies.
    if (!m || m[2].trim() === "") continue;
    out.set(m[1], m[2].trim());
  }
  return out;
}

Deno.test("every file under plugin/ is either mirrored or excluded with a reason", async () => {
  const root = abs("plugin");
  const exclusions = readExclusions();
  const paired = new Set(SYNC_PAIRS.map((p) => p.plugin));

  const assets: string[] = [];
  for await (
    // followSymlinks stays false — the default. `deno task test` runs with an
    // unscoped --allow-read, so the runtime adds no second boundary and the
    // walk's own configuration is the only one. Each path is checked to resolve
    // INSIDE the root before it is reported: resolve then verify containment,
    // never strip "..".
    const entry of walk(root, { includeDirs: false, followSymlinks: false })
  ) {
    // Containment against the WALK root, not the repository root. Checking the
    // latter was unsatisfiable in principle — a walk yields lexical descendants
    // of its own root, which are trivially inside the repo — so the guard read
    // as a live safeguard while being unable to fire. Against `plugin/` it can:
    // that is what a symlink out of the tree would produce if `followSymlinks`
    // were ever turned on.
    const fromWalkRoot = posix(relative(root, entry.path));
    if (fromWalkRoot.startsWith("..") || fromWalkRoot.startsWith("/")) {
      throw new Error(
        `plugin walk escaped plugin/: ${entry.path}. ` +
          `followSymlinks must stay false.`,
      );
    }
    assets.push(posix(relative(abs(""), entry.path)));
  }

  // The floor. A walk that resolves the wrong root, or yields nothing, would
  // otherwise report zero uncovered and pass — reporting coverage that does not
  // exist, which is the class this sweep exists to close. The bound is derived
  // from SYNC_PAIRS' own length, so it cannot go stale: there cannot be fewer
  // assets on disk than there are pairs claiming to point at them.
  // The floor bounds the POPULATION, not just a zero-length walk. Against
  // SYNC_PAIRS.length alone it had 8 files of slack — enough that re-scoping the
  // walk to `exts: [".md"]` (the scoping FR-001 forbids, and the one the plan's
  // security audit reversed the decision on) left 65 assets, 64 paired, 1
  // Markdown exclusion, zero uncovered, and the whole suite green. That is the
  // requirement enforced by prose and by no assertion.
  //
  // Every asset is either paired or excluded, so the two counts sum to the
  // population and the floor is exact. A file added with its pair raises both;
  // a file re-scoped OUT of the walk lowers only the left-hand side.
  assertGreaterOrEqual(
    assets.length,
    SYNC_PAIRS.length + exclusions.size,
    `The plugin walk found ${assets.length} asset(s), but ${SYNC_PAIRS.length} ` +
      `pair(s) + ${exclusions.size} exclusion(s) claim ${SYNC_PAIRS.length + exclusions.size}. ` +
      `Something narrowed the walk — a failed enumeration, or a file-type scope ` +
      `that FR-001 forbids. Either way it is not a clean tree.`,
  );

  const uncovered = assets
    .filter((a) => !paired.has(a) && !exclusions.has(a))
    .sort();

  assertEquals(
    uncovered,
    [],
    `${uncovered.length} plugin asset(s) are governed by nothing — neither a ` +
      `SYNC_PAIRS row nor an entry in ${EXCLUSIONS_FILE}:\n` +
      uncovered.map((u) => `  - ${u}`).join("\n") +
      `\n\nAdd a pair if the file mirrors one under templates/core/, or an ` +
      `exclusion WITH A WRITTEN REASON if it does not. An entry carrying no ` +
      `reason is not an entry and will not clear this.`,
  );
});

Deno.test("an exclusion entry with no written reason grants nothing", () => {
  // FR-002 had no witness on this half. The reader drops a reason-less entry
  // and the comment claimed the sweep then names the file as uncovered — true,
  // and asserted by nothing. The two bash readers of the same rule REPORT it
  // and are fatal, so the three spellings already disagreed on behaviour, which
  // is precisely what the plan's §9 says the duplication costs.
  //
  // Synthetic input, so this cannot go quiet the day the real list happens to
  // hold no such entry.
  const parsed = readExclusions(
    [
      "# a comment",
      "plugin/with-reason.md  a fact about the file",
      "plugin/no-reason.md",
      "plugin/whitespace-only.md   ",
    ].join("\n"),
  );
  assertEquals([...parsed.keys()], ["plugin/with-reason.md"]);
  assertEquals(parsed.get("plugin/with-reason.md"), "a fact about the file");
});

Deno.test("no exclusion entry excuses a file that no longer exists", () => {
  // `scripts/smoke/audit.sh` scans its allow-list for this and treats it as
  // fatal. A second reader of the same rule, elsewhere, shipped without the scan
  // and nobody noticed — because that list happened to stay clean. An allow-list
  // that excuses nothing while looking like it does is the defect this sweep is
  // about, one level up, so this reader has the scan from the start.
  const stale = [...readExclusions().keys()]
    .filter((path) => {
      try {
        Deno.statSync(abs(path));
        return false;
      } catch {
        return true;
      }
    })
    .sort();
  assertEquals(
    stale,
    [],
    `${stale.length} exclusion entr(y/ies) name a file that no longer exists:\n` +
      stale.map((s) => `  - ${s}`).join("\n") +
      `\n\nPrune them. An entry that excuses nothing while looking like it ` +
      `does is exactly what this sweep exists to remove.`,
  );
});

Deno.test(
  "plugin/.claude-plugin/plugin.json declares name 'specnaut-plugin'",
  async () => {
    const manifest = JSON.parse(
      await Deno.readTextFile(abs("plugin/.claude-plugin/plugin.json")),
    );
    assertEquals(manifest.name, "specnaut-plugin");
    assertEquals(typeof manifest.description, "string");
    assertEquals(typeof manifest.version, "string");
  },
);

// ─── The REVERSE sweep (#571) ───────────────────────────────────────────
//
// The sweep above walks `plugin/` and asks whether every asset there has a
// source. It is structurally blind to the other direction — a file the product
// SHIPS that the plugin does not carry has no row under `plugin/` to be missing
// from — and that blindness is not hypothetical: the entire `board` skill was
// absent from the plugin from the day it was created, while eight plugin assets
// dispatched to `/board`, and `code-audit` was absent while six did. Both stayed
// green under a completeness test whose own comment claims to measure a tree
// rather than its claims.
//
// The population is DERIVED from `templates/manifest.json` — what `init`
// actually installs — not from a list beside this test. That is what makes
// `alias-example` fall out on its own: the manifest never installs it, so it is
// outside the population by construction rather than by an exception someone
// remembered to write.

const SOURCE_EXCLUSIONS_FILE = "tests/plugin/source-exclusions.txt";

type ManifestEntry = { category?: string; name?: string; source?: string };

/** Every `templates/`-relative path the manifest installs from a mirrorable
 * category. Agents and skills are what the plugin carries; everything else
 * (`root/`, `specnaut/`, harness-specific) has no plugin counterpart by
 * design. */
function installedMirrorableSources(): string[] {
  const manifest = JSON.parse(
    Deno.readTextFileSync(abs("templates/manifest.json")),
  ) as { core?: ManifestEntry[] };
  const out = new Set<string>();
  for (const entry of manifest.core ?? []) {
    const src = entry.source;
    if (typeof src !== "string") continue;
    if (src.startsWith("core/skills/") || src.startsWith("core/agents/")) out.add(src);
  }
  return [...out].sort();
}

Deno.test("every skill and agent the manifest installs is mirrored, or excused with a reason", () => {
  const sources = installedMirrorableSources();

  // A FLOOR. A manifest that failed to parse, or a filter that matched
  // nothing, would otherwise pass this test in silence — which is the exact
  // shape of guard this ticket exists to remove, arriving inside its own fix.
  assertGreaterOrEqual(
    sources.length,
    100,
    `the manifest yielded ${sources.length} mirrorable sources; it yielded 129 when this ` +
      `landed, so a much smaller number means the parse broke, not that the product shrank`,
  );

  // A row in SYNC_PAIRS is a CLAIM; the file on disk is the fact. Checking
  // membership alone, this test stayed green with `plugin/skills/board/`
  // deleted from the tree — the rows still said it was mirrored. That is the
  // defect this sweep exists to remove, reproduced inside the sweep itself, so
  // the pair is only counted when its plugin file is actually there.
  const mirrored = new Set(
    SYNC_PAIRS
      .filter((p) => {
        try {
          return Deno.statSync(abs(p.plugin)).isFile;
        } catch {
          return false;
        }
      })
      .map((p) => p.source.replace(/^templates\//, "")),
  );
  const exclusions = readExclusions(
    Deno.readTextFileSync(abs(SOURCE_EXCLUSIONS_FILE)),
  );

  const unmirrored = sources.filter((src) => {
    if (mirrored.has(src)) return false;
    for (const [pattern] of exclusions) {
      if (pattern.endsWith("/") ? src.startsWith(pattern) : src === pattern) return false;
    }
    return true;
  });

  assertEquals(
    unmirrored,
    [],
    `The product installs ${unmirrored.length} file(s) the plugin does not carry:\n` +
      unmirrored.map((u) => `  - ${u}`).join("\n") +
      `\n\nEither mirror them into plugin/ and add a SYNC_PAIRS row, or add a line to ` +
      `${SOURCE_EXCLUSIONS_FILE} saying why the plugin should not carry them.`,
  );
});

Deno.test("every source exclusion names something the manifest actually installs", () => {
  // The exclusion list's own hygiene, in the direction nobody checks: an entry
  // for a path the product no longer ships excuses nothing while looking like
  // it does, and it hides the day that path comes back.
  const sources = installedMirrorableSources();
  const exclusions = readExclusions(
    Deno.readTextFileSync(abs(SOURCE_EXCLUSIONS_FILE)),
  );
  const orphans = [...exclusions.keys()].filter((pattern) =>
    !sources.some((s) => (pattern.endsWith("/") ? s.startsWith(pattern) : s === pattern))
  );
  assertEquals(
    orphans,
    [],
    `excused, but the manifest installs no such file:\n${orphans.join("\n")}`,
  );
});
