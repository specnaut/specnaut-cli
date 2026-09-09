import { assert, assertEquals } from "@std/assert";
import { WindsurfHarness } from "../../../src/infrastructure/harness/windsurf_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";
import { CORE_BUNDLE } from "../../../src/templates_bundle.ts";
import { everyBundleOption } from "../../../src/application/ports.ts";
import {
  describeOversizeWorkflow,
  WINDSURF_WORKFLOW_BUDGET_CHARS,
  WINDSURF_WORKFLOW_MAX_CHARS,
  workflowLength,
} from "../../../src/infrastructure/harness/windsurf_harness.ts";

const SAMPLE: CoreBundle = [
  {
    category: "skill",
    name: "specnaut",
    suffix: null,
    content: "---\nname: specnaut\ndescription: Specnaut router\n---\n\n# Body\n",
    executable: false,
  },
  {
    category: "phase",
    name: "specify",
    suffix: "specify.md",
    content: "# Specify phase\n",
    executable: false,
  },
  {
    category: "skill",
    name: "specnaut-auto",
    suffix: null,
    content: "---\ndescription: Auto-chain dispatcher\n---\n\n# body\n",
    executable: false,
  },
  {
    category: "agent",
    name: "product-owner",
    suffix: null,
    content: "---\nname: product-owner\ndescription: Product Owner role\n---\n\nYou are the PO.\n",
    executable: false,
  },
  {
    category: "spec-root",
    name: "specify",
    suffix: "memory/constitution.md",
    content: "# const\n",
    executable: false,
  },
  {
    category: "project-root",
    name: "root",
    suffix: "AGENTS.md",
    content: "# AGENTS\n",
    executable: false,
  },
];

Deno.test("WindsurfHarness.key and displayName", () => {
  const h = new WindsurfHarness();
  assertEquals(h.key, "windsurf");
  assertEquals(h.displayName, "Windsurf");
});

Deno.test("WindsurfHarness maps router skill to .windsurf/workflows/specnaut.md", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assert(".windsurf/workflows/specnaut.md" in mapped);
});

Deno.test("WindsurfHarness maps phase docs to sibling specnaut-<phase>.md files", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assert(".windsurf/workflows/specnaut-specify.md" in mapped);
});

Deno.test("WindsurfHarness maps skill to .windsurf/workflows/specnaut-<name>.md", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assert(".windsurf/workflows/specnaut-auto.md" in mapped);
});

Deno.test("WindsurfHarness maps agents to .windsurf/workflows/specnaut-agent-<name>.md", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assert(".windsurf/workflows/specnaut-agent-product-owner.md" in mapped);
});

Deno.test("WindsurfHarness maps spec-root to .specnaut/<suffix> and project-root to <suffix>", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  assert(".specnaut/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
});

Deno.test("WindsurfHarness emits content byte-identical to entry.content (no frontmatter rewrite)", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  const router = mapped[".windsurf/workflows/specnaut.md"];
  assertEquals(router.content, SAMPLE[0].content);
  const phase = mapped[".windsurf/workflows/specnaut-specify.md"];
  assertEquals(phase.content, SAMPLE[1].content);
});

Deno.test("WindsurfHarness emits no Claude/Cursor/Codex artefacts", () => {
  const h = new WindsurfHarness();
  const mapped = h.mapBundle(SAMPLE, {
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
  });
  const keys = Object.keys(mapped);
  assert(!keys.some((k) => k.startsWith(".claude/")), "no .claude/");
  assert(!keys.some((k) => k.startsWith(".cursor/")), "no .cursor/");
  assert(!keys.some((k) => k.startsWith(".agents/")), "no .agents/");
  assert(!keys.some((k) => k.startsWith(".codex/")), "no .codex/");
  assert(!keys.includes("CLAUDE.md"), "no CLAUDE.md");
});

Deno.test("WindsurfHarness emits no workflow over the Cascade budget", () => {
  // #539 settled the UNIT: characters, the unit the vendor's limit uses.
  // #562 settled the SET. This loop used to spell its own axes — backlog
  // backend and version scheme — and pin `specBackend: "local"`. It never
  // mentioned `specAutogen` at all, because that field is optional and a
  // caller who omits it compiles. So it measured 16 of 32 combinations and
  // reported itself green while `specnaut-board.md` emitted at 12,539
  // characters, 539 past the cap, on github + cloud + autogen.
  //
  // A loop spells the axes it happens to remember. `everyBundleOption()` is
  // derived from `BundleOptions` itself, so it cannot forget one: a new field
  // fails to compile rather than silently narrowing what this measures.
  //
  // Reporting the three measures on failure is deliberate: the gap between
  // them is what made the pre-#539 reading ambiguous.
  const h = new WindsurfHarness();
  // Reported pass or fail. The assertion alone is binary — green until the day
  // it is red — and gives nobody a way to see the margin halving over a year.
  let worst = { chars: -1, path: "", where: "" };
  for (const opts of everyBundleOption()) {
    const mapped = h.mapBundle(CORE_BUNDLE, opts);
    for (const [path, file] of Object.entries(mapped)) {
      if (!path.startsWith(".windsurf/workflows/")) continue;
      const chars = workflowLength(file.content);
      const where = `backlog=${opts.backlogBackend} scheme=${opts.versionScheme} ` +
        `spec=${opts.specBackend} autogen=${opts.specAutogen}`;
      if (chars > worst.chars) worst = { chars, path, where };
      assert(
        chars <= WINDSURF_WORKFLOW_BUDGET_CHARS,
        describeOversizeWorkflow(path, file.content, where),
      );
    }
  }
  console.log(
    `  windsurf headroom: tightest is ${worst.path} at ${worst.chars} chars — ` +
      `${WINDSURF_WORKFLOW_BUDGET_CHARS - worst.chars} under budget, ` +
      `${WINDSURF_WORKFLOW_MAX_CHARS - worst.chars} under cap (${worst.where})`,
  );
});

Deno.test("the emitted workflow set is the same on every install combination", () => {
  // A size assertion is satisfied by DELETION. Three ways to pass one without
  // shortening anything: drop the file (a backend filter returning null), move
  // its destination (the size loop filters on the `.windsurf/workflows/`
  // prefix), or iterate nothing. None of them is hypothetical — this repository
  // just shipped a workflow 539 characters over the vendor cap because the
  // guard was looking at half the parameter space.
  //
  // So: the set of emitted paths must be IDENTICAL across every combination,
  // and non-empty. A file dropped on one backend shows up here as a set
  // difference rather than as a quietly smaller measurement.
  const h = new WindsurfHarness();
  let expected: string[] | null = null;
  let expectedFrom = "";
  for (const opts of everyBundleOption()) {
    const paths = Object.keys(h.mapBundle(CORE_BUNDLE, opts))
      .filter((p) => p.startsWith(".windsurf/workflows/"))
      .sort();
    const where = `backlog=${opts.backlogBackend} scheme=${opts.versionScheme} ` +
      `spec=${opts.specBackend} autogen=${opts.specAutogen}`;
    if (expected === null) {
      expected = paths;
      expectedFrom = where;
      // Non-vacuity. Without this the whole test passes over an empty set,
      // which is exactly the "iterate nothing" failure it is meant to catch.
      assert(paths.length > 50, `only ${paths.length} workflows emitted on ${where}`);
      continue;
    }
    const missing = expected.filter((p) => !paths.includes(p));
    const extra = paths.filter((p) => !expected!.includes(p));
    assertEquals(
      [missing, extra],
      [[], []],
      `the emitted workflow set differs on ${where} vs ${expectedFrom} — ` +
        `missing here: ${missing.join(", ") || "none"}; ` +
        `extra here: ${extra.join(", ") || "none"}`,
    );
  }
});

Deno.test("workflowLength counts characters, not UTF-16 code units", () => {
  // The distinction only shows on astral-plane characters, which is exactly
  // when a length assertion quietly starts measuring something else.
  assertEquals(workflowLength("abc"), 3);
  assertEquals("👋".length, 2);
  assertEquals(workflowLength("👋"), 1);
  // A BMP non-ASCII character costs one character and three bytes — the axis
  // that put four workflows over the limit when read as bytes.
  assertEquals(workflowLength("—"), 1);
  assertEquals(new TextEncoder().encode("—").length, 3);
});

/**
 * The count of emitted workflows whose worst-case slack is under the reserve's
 * own width. Pinned, not computed — the point is that it may not GROW.
 *
 * Lower it whenever the population drops; the assertion below is an equality
 * and will tell you to. Never raise it.
 */
const WINDSURF_CLUSTERED_WORKFLOWS = 8;

Deno.test("the cluster of workflows crowding the Cascade budget does not grow", () => {
  // The per-file assertion above is a ceiling, and a ceiling is satisfied by
  // trimming whichever file touched it. That is what happened: a 300-character
  // reserve was introduced BECAUSE six workflows sat within 100 characters of
  // the cap and two had to be trimmed in emergencies on one day (#561, #562).
  // The reserve moved the line. The cluster re-formed against the new line —
  // eight workflows now sit inside the reserve's own width — because nothing
  // measures the population, only the maximum.
  //
  // So this gates the POPULATION. A count cannot be satisfied by trimming one
  // file, which is precisely the move that produced the cluster twice.
  //
  // The threshold is derived, never written down: it is the reserve's own
  // width, `MAX - BUDGET`. Widening the reserve to make this pass therefore
  // widens the threshold too, admitting MORE files — and lowers the budget
  // under the four workflows nearest it, so the per-file assertion fails first.
  // Both exits are closed by construction rather than by a comment asking
  // nobody to take them.
  const h = new WindsurfHarness();
  const reserve = WINDSURF_WORKFLOW_MAX_CHARS - WINDSURF_WORKFLOW_BUDGET_CHARS;

  // Worst case PER PATH, across every combination — a workflow's length varies
  // with the install options, and the tightest one is the one that binds.
  const worstPerPath = new Map<string, number>();
  for (const opts of everyBundleOption()) {
    for (const [path, file] of Object.entries(h.mapBundle(CORE_BUNDLE, opts))) {
      if (!path.startsWith(".windsurf/workflows/")) continue;
      const chars = workflowLength(file.content);
      worstPerPath.set(path, Math.max(worstPerPath.get(path) ?? -1, chars));
    }
  }

  const clustered = [...worstPerPath]
    .map(([path, chars]) => ({ path, chars, slack: WINDSURF_WORKFLOW_BUDGET_CHARS - chars }))
    .filter((w) => w.slack < reserve)
    .sort((a, b) => a.slack - b.slack);

  const roster = clustered.map((w) => `${w.path} (${w.slack} left)`).join("\n    ");
  assertEquals(
    clustered.length,
    WINDSURF_CLUSTERED_WORKFLOWS,
    clustered.length > WINDSURF_CLUSTERED_WORKFLOWS
      ? `${clustered.length} workflows now sit within ${reserve} characters of the ` +
        `${WINDSURF_WORKFLOW_BUDGET_CHARS} budget, up from ${WINDSURF_CLUSTERED_WORKFLOWS}. ` +
        `Trimming the largest one will NOT satisfy this — the count is the subject. ` +
        `Shorten or split what you added, and do not raise the reserve.\n    ${roster}`
      : `only ${clustered.length} workflows are still within ${reserve} characters of ` +
        `the budget, down from ${WINDSURF_CLUSTERED_WORKFLOWS}. Lower ` +
        `WINDSURF_CLUSTERED_WORKFLOWS to ${clustered.length} — the pin ratchets down ` +
        `and never up.\n    ${roster}`,
  );

  // Non-vacuity, in the same shape as the set assertion above: an empty or
  // near-empty universe would satisfy a population count trivially.
  assert(
    worstPerPath.size > 50,
    `only ${worstPerPath.size} workflows were measured — the population was read off nothing`,
  );

  console.log(
    `  windsurf cluster: ${clustered.length} of ${worstPerPath.size} workflows within ` +
      `${reserve} chars of the budget (pin ${WINDSURF_CLUSTERED_WORKFLOWS})`,
  );
});
