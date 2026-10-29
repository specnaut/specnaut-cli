import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * #460 — `specnaut upgrade` must leave no orphan behind from the phases #455
 * deleted.
 *
 * The removal machinery is lock-driven and already existed: a lock entry that
 * is no longer in the new bundle becomes a `remove` action when the file is
 * still on disk. What did NOT exist is a test proving it for THIS set of files,
 * and "the mechanism is generic so it must work" is exactly the assumption that
 * ships a project still carrying `phases/specify.md` next to a router that no
 * longer routes to it — a stale file an agent can still read and act on.
 *
 * So this simulates a pre-#455 install honestly: real files on disk, real
 * entries in the lock with real hashes, then a real upgrade.
 */

const REMOVED_PHASES = [
  "brainstorm",
  "specify",
  "clarify",
  "analyze",
  "checklist",
  "list-skills",
  "lite-heuristic",
] as const;

const REMOVED_TEMPLATES = [
  ".specnaut/templates/spec-template.md",
  ".specnaut/templates/checklist-template.md",
] as const;

async function runSpecnaut(args: string[], cwd: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("upgrade removes every phase and template #455/#457 deleted, leaving no orphan", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-upgrade-orphan-" });
  try {
    const init = await runSpecnaut(
      ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"],
      dir,
    );
    assertEquals(init.code, 0, `init failed: ${init.stderr}`);

    // Simulate the pre-#455 install: the files exist on disk AND are recorded
    // in the lock. Both halves matter — an unrecorded file is not an orphan the
    // upgrade owns, it is a user file, and deleting it would be a bug.
    const planted: string[] = [
      ...REMOVED_PHASES.map((n) => `.claude/skills/specnaut/phases/${n}.md`),
      ...REMOVED_TEMPLATES,
    ];

    const lockPath = join(dir, ".specnaut/installed.lock");
    let lock = await Deno.readTextFile(lockPath);
    const body = `# placeholder for a phase this version no longer ships\n`;
    const hash = await sha256(body);

    for (const rel of planted) {
      const abs = join(dir, rel);
      await Deno.mkdir(join(abs, ".."), { recursive: true });
      await Deno.writeTextFile(abs, body);
      lock += `  ${rel}:\n    sha256: ${hash}\n    installed_at: "2026-01-01T00:00:00Z"\n` +
        `    templates_version: 1.0.0\n`;
    }
    await Deno.writeTextFile(lockPath, lock);

    for (const rel of planted) {
      assertEquals(await exists(join(dir, rel)), true, `setup failed to plant ${rel}`);
    }

    const up = await runSpecnaut(["upgrade", "--force"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

    for (const rel of planted) {
      assertEquals(
        await exists(join(dir, rel)),
        false,
        `${rel} survived the upgrade — a stale phase doc an agent can still read`,
      );
    }

    // And the surviving set is intact: removal must not overshoot.
    for (
      const rel of [
        ".claude/skills/specnaut/SKILL.md",
        ".claude/skills/task/phases/plan.md",
        ".claude/skills/task/phases/plan-audits.md",
        ".claude/skills/task/phases/tasks.md",
        ".claude/skills/task/phases/implement.md",
        ".claude/skills/task/phases/review.md",
        ".claude/skills/task/phases/merge.md",
        ".specnaut/templates/plan-template.md",
        ".specnaut/templates/tasks-template.md",
      ]
    ) {
      assertEquals(await exists(join(dir, rel)), true, `${rel} must survive the upgrade`);
    }

    // The lock is the audit trail: it must no longer claim the removed files.
    const after = await Deno.readTextFile(lockPath);
    for (const rel of planted) {
      assert(!after.includes(rel), `lock still records the removed ${rel}`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
