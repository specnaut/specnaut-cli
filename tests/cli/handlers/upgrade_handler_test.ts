import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { switchBacklogBackend } from "../../../src/cli/handlers/upgrade_handler.ts";
import { parseLock } from "../../../src/domain/installed_lock.ts";

const MAIN = fromFileUrl(new URL("../../../src/main.ts", import.meta.url));

async function runSpecflow(
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
 * Init a parent-managed child so it carries a `parent_managed: true` lock with
 * no agentic entries — the realistic precondition for a backend switch.
 */
async function initializedParentManagedChild(): Promise<{ root: string; child: string }> {
  const root = await Deno.makeTempDir({ prefix: "specflow-switch-pm-" });
  const parent = join(root, "parent");
  const child = join(parent, "child");
  await Deno.mkdir(join(parent, ".specflow"), { recursive: true });
  await Deno.mkdir(child, { recursive: true });
  await Deno.writeTextFile(
    join(parent, "deno.json"),
    JSON.stringify({ workspace: ["./child"] }, null, 2),
  );
  const { code, stderr } = await runSpecflow(["init", "--here", "--no-git"], { cwd: child });
  assertEquals(code, 0, `init precondition failed: ${stderr}`);
  return { root, child };
}

// HIGH — switching backlog backend on a parent-managed lock must preserve the
// parent-managed decision (FR-012). Dropping it silently re-enables agentic
// provisioning on the next upgrade.
Deno.test("switchBacklogBackend preserves parent_managed and excludes agentic entries", async () => {
  const { root, child } = await initializedParentManagedChild();
  try {
    const lockPath = join(child, ".specflow/installed.lock");
    const before = parseLock(await Deno.readTextFile(lockPath));
    assertEquals(before.parentManaged, true, "precondition: lock must be parent-managed");
    assertEquals(before.backlogBackend, "local", "precondition: starts on local backend");

    const { switched, from } = await switchBacklogBackend(child, "github");
    assertEquals(switched, true);
    assertEquals(from, "local");

    const after = parseLock(await Deno.readTextFile(lockPath));
    // Backend switched...
    assertEquals(after.backlogBackend, "github");
    // ...but the parent-managed decision survived.
    assertEquals(after.parentManaged, true);
    // ...and no agentic entry was re-introduced.
    for (const dest of after.entries.keys()) {
      assert(
        !dest.startsWith(".claude/skills/") &&
          !dest.startsWith(".claude/agents/") &&
          !dest.startsWith(".claude/commands/"),
        `agentic entry leaked into lock after switch: ${dest}`,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
