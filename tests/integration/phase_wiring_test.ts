import { assertEquals } from "@std/assert";
import { ClaudeHarness } from "../../src/infrastructure/harness/claude_harness.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { BundleOptions } from "../../src/application/ports.ts";

// Spec 021 — end-to-end phase wiring through the real harness pipeline
// (applyBackend → applyScheme → applySpecBackend → applySpecAutogen). We drive
// the Claude harness because its destinations are the canonical
// `.claude/skills/...` tree; the render logic is harness-agnostic.

const harness = new ClaudeHarness();

function bundle(opts: BundleOptions): Record<string, string> {
  const b = harness.mapBundle(CORE_BUNDLE, opts);
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.content]));
}

const CONSUMING = ["implement", "review", "tasks"] as const;
/**
 * A phase document's destination, derived through the adapter rather than
 * spelled here. A literal would be a second statement of the adapter's rule
 * (spec 033 §5), and — worse for a gate — it would keep matching `specnaut`'s
 * documents while quietly excluding any other skill's, so coverage could shrink
 * without a single test going red.
 */
const phaseDests = (): ReadonlyArray<string> =>
  CORE_BUNDLE
    .filter((e) => e.category === "phase")
    .map((e) => Object.keys(harness.mapBundle([e], LOCAL_OPTS))[0]);

const phaseDest = (name: string) => {
  const want = `/${name}.md`;
  const hit = phaseDests().find((d) => d.endsWith(want));
  if (!hit) throw new Error(`no bundled phase document named ${name}.md`);
  return hit;
};
const BACKLOG_SKILL = ".claude/skills/board/SKILL.md";

/** Any single combination resolves a destination; the render options do not move it. */
const LOCAL_OPTS: BundleOptions = {
  backlogBackend: "local",
  versionScheme: "semver",
  specBackend: "local",
};

/** Every phase document's destination, as the adapter computes it. */
const ALL_PHASE_DESTS = new Set(phaseDests());

// A derived set can go empty and take the gate with it — silently, which is the
// failure this derivation exists to remove, arriving through the door that
// removed it. Pin the size to the bundle's own phase count.
Deno.test("the phase-destination derivation is not vacuous", () => {
  const phases = CORE_BUNDLE.filter((e) => e.category === "phase").length;
  assertEquals(ALL_PHASE_DESTS.size, phases);
  assertEquals(phases > 0, true, "the bundle ships no phase documents at all");
});
const AUTOGEN_HEADING = "## Auto-generate a task's spec at creation";

function countPulls(s: string): number {
  return (s.match(/specnaut spec pull <task>/g) ?? []).length;
}

// US1 / SC-001 / T006 — in cloud mode each consuming phase materialises the spec
// exactly once at entry; in local mode no pull is emitted at all.
Deno.test("T006 cloud render: each consuming phase doc pulls the spec exactly once at entry", () => {
  const b = bundle({ backlogBackend: "cloud", versionScheme: "semver", specBackend: "cloud" });
  for (const name of CONSUMING) {
    const doc = b[phaseDest(name)];
    assertEquals(
      countPulls(doc),
      1,
      `${name}.md (cloud) must contain exactly one \`spec pull <task>\` step`,
    );
    assertEquals(doc.includes("spec-backend="), false, `${name}.md leaked a spec-backend marker`);
  }
});

Deno.test("T006 local render: no consuming phase doc emits a spec pull", () => {
  const b = bundle({ backlogBackend: "local", versionScheme: "semver", specBackend: "local" });
  for (const name of CONSUMING) {
    const doc = b[phaseDest(name)];
    assertEquals(countPulls(doc), 0, `${name}.md (local) must not pull — FR-003 local parity`);
  }
});

// US2 / SC-003 / T010 — the auto-generation guidance renders only when
// `spec_autogen && spec_backend === "cloud"`; it is absent for every other combo.
Deno.test("T010 auto-gen guidance renders only with spec_autogen: true AND cloud", () => {
  const has = (opts: BundleOptions) => bundle(opts)[BACKLOG_SKILL].includes(AUTOGEN_HEADING);

  // enabled + cloud → present
  assertEquals(
    has({
      backlogBackend: "cloud",
      versionScheme: "semver",
      specBackend: "cloud",
      specAutogen: true,
    }),
    true,
  );
  // enabled but LOCAL spec backend → absent (auto-gen runs cloud `specify`)
  assertEquals(
    has({
      backlogBackend: "cloud",
      versionScheme: "semver",
      specBackend: "local",
      specAutogen: true,
    }),
    false,
  );
  // cloud but toggle off → absent
  assertEquals(
    has({
      backlogBackend: "cloud",
      versionScheme: "semver",
      specBackend: "cloud",
      specAutogen: false,
    }),
    false,
  );
  // cloud but toggle absent (default off) → absent
  assertEquals(
    has({ backlogBackend: "cloud", versionScheme: "semver", specBackend: "cloud" }),
    false,
  );
});

Deno.test("T010 the backlog skill never leaks a raw spec-autogen marker in any render", () => {
  for (const specAutogen of [true, false]) {
    for (const specBackend of ["local", "cloud"] as const) {
      const doc = bundle({
        backlogBackend: "cloud",
        versionScheme: "semver",
        specBackend,
        specAutogen,
      })[BACKLOG_SKILL];
      assertEquals(doc.includes("spec-autogen="), false);
      assertEquals(doc.includes("BEGIN: spec-autogen"), false);
    }
  }
});

// SC-002 / T012 — a fully local project (default, no cloud, no autogen) sees no
// pull anywhere and no auto-gen guidance: byte-for-byte the pre-feature workflow.
Deno.test("T012 local end-to-end: no pull in any phase doc and no auto-gen guidance", () => {
  const b = bundle({ backlogBackend: "local", versionScheme: "semver", specBackend: "local" });
  for (const [dest, content] of Object.entries(b)) {
    if (ALL_PHASE_DESTS.has(dest)) {
      assertEquals(
        countPulls(content),
        0,
        `${dest} pulled in local mode — the local workflow must be unchanged`,
      );
    }
  }
  assertEquals(b[BACKLOG_SKILL].includes(AUTOGEN_HEADING), false);
});
