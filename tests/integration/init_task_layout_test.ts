// The skill layout `init` scaffolds on Claude Code: the `/task` router and
// its phase docs, `/specnaut` reduced to the framework's verbs, and none of
// the skills `/task` absorbed (cli#683). Split out of init_test.ts, which was
// over its size ceiling when cli#683 had to add to it.
import { assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { join } from "@std/path";
import { runSpecnaut } from "../helpers/run_specnaut.ts";

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-integ-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specnaut init <name> scaffolds the task skill in place of the retired ones", async () => {
  await withTempDir(async (dir) => {
    const { code, stderr } = await runSpecnaut(["init", "demo", "--no-git"], { cwd: dir });
    assertEquals(code, 0, `init failed: ${stderr}`);
    const root = join(dir, "demo");
    // The phase chain lives in the task router skill (#455 / #456, cli#683).
    assertEquals(
      await exists(join(root, ".claude/skills/specnaut/SKILL.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".claude/skills/task/phases/plan.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".claude/skills/task/groom.md")),
      true,
    );
    // cli#683: the backlog, pipeline and audit skills are one `task` skill.
    for (
      const retired of [
        "board",
        "code-audit",
        "sec-audit",
        "arch-audit",
        "perf-audit",
        "a11y-audit",
        "dep-audit",
      ]
    ) {
      assertEquals(
        await exists(join(root, `.claude/skills/${retired}`)),
        false,
        `retired skill must NOT scaffold: ${retired}`,
      );
    }
    assertEquals(
      await exists(join(root, ".claude/skills/specnaut/phases/plan.md")),
      false,
      "the pipeline left /specnaut",
    );
  });
});

// ── Consolidated router skill (v1.0.0) ──────────────────────────────────

Deno.test("specnaut init scaffolds the consolidated router skill + its phase docs", async () => {
  await withTempDir(async (dir) => {
    const { code } = await runSpecnaut(
      ["init", "demo", "--no-git", "--ai", "claude", "--backlog", "local"],
      { cwd: dir },
    );
    assertEquals(code, 0);

    const root = join(dir, "demo");
    assertEquals(
      await exists(join(root, ".claude/skills/specnaut/SKILL.md")),
      true,
    );
    for (
      const name of [
        "plan",
        "plan-audits",
        "tasks",
        "implement",
        "review",
        "merge",
        "constitution",
      ]
    ) {
      assertEquals(
        await exists(
          join(root, `.claude/skills/task/phases/${name}.md`),
        ),
        true,
        `expected .claude/skills/task/phases/${name}.md`,
      );
      // Old per-phase folders are gone post-consolidation.
      if (name !== "review") {
        assertEquals(
          await exists(join(root, `.claude/skills/specnaut-${name}/SKILL.md`)),
          false,
          `legacy per-phase folder must NOT exist`,
        );
      }
    }
    // Old standalone groom skill removed.
    assertEquals(
      await exists(join(root, ".claude/skills/specnaut-groom/SKILL.md")),
      false,
    );
    // #534: retired.
    assertEquals(
      await exists(join(root, ".claude/skills/specnaut-review/SKILL.md")),
      false,
    );
    const routerContent = await Deno.readTextFile(
      join(root, ".claude/skills/task/SKILL.md"),
    );
    assertStringIncludes(routerContent, "name: task");
    // The router must NOT carry `disable-model-invocation: true` —
    // /task auto-chains phases via `Skill(task, "<phase>")`,
    // and that flag would block the chain on Claude Code (#166).
    assertEquals(
      routerContent.includes("disable-model-invocation: true"),
      false,
    );
  });
});

// Since cli#680 `.claude/CLAUDE.md` is a link to AGENTS.md: reading it reads
