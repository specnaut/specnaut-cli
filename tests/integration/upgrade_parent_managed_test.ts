import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";
import { parseLock } from "../../src/domain/installed_lock.ts";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

async function runSpecnaut(
  args: string[],
  opts: { cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      MAIN,
      ...args,
    ],
    cwd: opts.cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await p.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

/**
 * Builds a providing-workspace fixture and runs `init --here` in the child so
 * the child carries a parent-managed `installed.lock` with no agentic files —
 * the realistic precondition for an upgrade.
 */
async function initializedParentManagedChild(): Promise<{ root: string; child: string }> {
  const root = await Deno.makeTempDir({ prefix: "specnaut-up-pm-" });
  const parent = join(root, "parent");
  const child = join(parent, "child");
  await Deno.mkdir(join(parent, ".specflow"), { recursive: true });
  await Deno.mkdir(child, { recursive: true });
  await Deno.writeTextFile(
    join(parent, "deno.json"),
    JSON.stringify({ workspace: ["./child"] }, null, 2),
  );
  const { code, stderr } = await runSpecnaut(["init", "--here", "--no-git"], { cwd: child });
  assertEquals(code, 0, `init precondition failed: ${stderr}`);
  // Sanity: init left no agentic files and a parent-managed lock.
  assertEquals(await exists(join(child, ".claude/skills")), false);
  return { root, child };
}

// C3 — SC-003, FR-007
Deno.test("no agentic resurrection", async () => {
  const { root, child } = await initializedParentManagedChild();
  try {
    const { code, stderr } = await runSpecnaut(["upgrade"], { cwd: child });
    assertEquals(code, 0, `upgrade failed: ${stderr}`);

    // Upgrade refreshed the toolkit but resurrected nothing under .claude/.
    assertEquals(await exists(join(child, ".specflow/installed.lock")), true);
    assertEquals(await exists(join(child, ".claude/skills")), false);
    assertEquals(await exists(join(child, ".claude/agents")), false);
    assertEquals(await exists(join(child, ".claude/commands")), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// C5 — SC-005, FR-012
Deno.test("lock has no agentic entries", async () => {
  const { root, child } = await initializedParentManagedChild();
  try {
    const { code, stderr } = await runSpecnaut(["upgrade"], { cwd: child });
    assertEquals(code, 0, `upgrade failed: ${stderr}`);

    const lockYaml = await Deno.readTextFile(join(child, ".specflow/installed.lock"));
    const lock = parseLock(lockYaml);
    assertEquals(lock.parentManaged, true);
    for (const dest of lock.entries.keys()) {
      assert(
        !dest.startsWith(".claude/skills/") &&
          !dest.startsWith(".claude/agents/") &&
          !dest.startsWith(".claude/commands/"),
        `agentic entry leaked into lock: ${dest}`,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
