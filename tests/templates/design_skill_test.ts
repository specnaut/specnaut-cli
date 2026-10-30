import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

/**
 * `/design` (#678) — the former `ui-ux-designer` agent, now a skill only the
 * user starts. Nothing dispatched the agent; a design-system pass is a decision
 * the user takes, so the skill refuses model invocation.
 *
 * The DESIGN.md shape has one home, the template (plan § 5). The skill points at
 * it; a skill that inlined the skeleton again would be a second copy that drifts.
 */

const TEMPLATE = "templates/design-template.md";

function entry(category: string, name: string, suffix: string | null) {
  const e = CORE_BUNDLE.find((x) =>
    x.category === category && x.name === name && x.suffix === suffix
  );
  assert(e, `${category}/${name}/${suffix} is not in CORE_BUNDLE`);
  return e!;
}

const skill = () => entry("skill", "design", null).content;
const template = () => entry("spec-root", "specify", TEMPLATE).content;

Deno.test("/design is user-invoked only", () => {
  const fm = /^---\n([\s\S]*?)\n---/.exec(skill())?.[1] ?? "";
  assertStringIncludes(fm, "name: design");
  assertStringIncludes(fm, "disable-model-invocation: true");
});

/**
 * The agent `/design` replaced had no shell (Read, Edit, Write, Glob, Grep), and
 * the skill's own text says "no command, no agent dispatch". Claude Code's
 * `disallowed-tools` removes tools from the pool while a skill is active
 * (https://code.claude.com/docs/en/skills, frontmatter reference); `Monitor`
 * runs commands too. `context: fork` would not do: a forked skill cannot hold
 * the Discovery interview. The removal lasts the invoking turn only, so the
 * prose still carries the rule after the user's first reply.
 */
Deno.test("/design runs with no shell and no agent dispatch on Claude Code", () => {
  const fm = /^---\n([\s\S]*?)\n---/.exec(skill())?.[1] ?? "";
  const line = /^disallowed-tools:\s*(.+)$/m.exec(fm)?.[1] ?? "";
  const removed = line.split(/[\s,]+/).filter(Boolean).sort();
  assertEquals(removed, ["Agent", "Bash", "Monitor", "PowerShell"]);
});

Deno.test("/design carries the three modes", () => {
  for (const mode of ["Discovery", "Edit", "Audit"]) {
    assert(new RegExp(`^## Mode \\d — ${mode}`, "m").test(skill()), `no ${mode} mode`);
  }
});

Deno.test("the DESIGN.md shape lives in the template, and the skill points at it", () => {
  assertStringIncludes(skill(), `.specnaut/${TEMPLATE}`);
  for (const section of ["## Brand identity", "## Color palette", "## Responsive and adaptive"]) {
    assertStringIncludes(template(), section);
    assertEquals(skill().includes(section), false, `the skill inlines "${section}"`);
  }
});
