import { assert, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";

/**
 * Locks the per-axis audit-dispatch family (#380) into the bundle so the five
 * thin skills can't drift apart. Each `/{axis}-audit` skill binds exactly one
 * axis to its existing auditor agent, documents the uniform scope args, carries
 * the 3-way disambiguation note (vs `/specnaut audit <axis>` report-writing, vs
 * `/code-audit` multi-seat team), and states it is read-only / writes no report.
 *
 * The five share one body template — looping the same invariants over all of
 * them is exactly how the spec wants the family policed (SC-001, SC-005, FR-008;
 * data-model.md invariants + contracts/dispatch-contract.md).
 */

/** Skill name → its single bound auditor agent (research.md axis→agent table). */
const AXIS_SKILLS: ReadonlyArray<{ skill: string; agent: string }> = [
  { skill: "arch-audit", agent: "architecture-auditor" },
  { skill: "sec-audit", agent: "security-auditor" },
  { skill: "perf-audit", agent: "performance-auditor" },
  { skill: "dep-audit", agent: "dependency-auditor" },
  { skill: "a11y-audit", agent: "a11y-auditor" },
];

function skillEntry(name: string): CoreEntry | undefined {
  return CORE_BUNDLE.find((e) => e.category === "skill" && e.name === name);
}

for (const { skill, agent } of AXIS_SKILLS) {
  Deno.test(`${skill} ships in CORE_BUNDLE`, () => {
    assert(
      skillEntry(skill),
      `expected a \`skill\` entry named ${skill} in CORE_BUNDLE`,
    );
  });

  Deno.test(`${skill} names its bound auditor agent (${agent})`, () => {
    const entry = skillEntry(skill)!;
    assertStringIncludes(
      entry.content,
      agent,
      `${skill} must name its single bound auditor ${agent}`,
    );
  });

  Deno.test(`${skill} documents the uniform scope args`, () => {
    const { content } = skillEntry(skill)!;
    for (const arg of ["--path", "--range", "--diff"]) {
      assertStringIncludes(
        content,
        arg,
        `${skill} must document the ${arg} scope form`,
      );
    }
  });

  Deno.test(`${skill} carries the 3-way disambiguation note`, () => {
    const { content } = skillEntry(skill)!;
    // Must reference both sibling surfaces so a reader can tell them apart.
    assertStringIncludes(
      content,
      "/specnaut audit",
      `${skill} must disambiguate from the report-writing /specnaut audit <axis>`,
    );
    assertStringIncludes(
      content,
      "/code-audit",
      `${skill} must disambiguate from the multi-seat /code-audit`,
    );
  });

  Deno.test(`${skill} states it is read-only / writes no report`, () => {
    const lower = skillEntry(skill)!.content.toLowerCase();
    assert(
      lower.includes("read-only"),
      `${skill} must state it is read-only`,
    );
    assert(
      lower.includes("no report") || lower.includes("no file") ||
        lower.includes("writes no"),
      `${skill} must state it writes no report file`,
    );
  });
}
