import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { parseLock, serializeLock } from "../../src/domain/installed_lock.ts";
import { runSpecnaut, sha256, withTempDir } from "./task_reorg_fixture.ts";

/**
 * cli#803 through the real entry point: a project whose `/task` router was
 * customised only to route `kanban` to a skill of its own gets the bundled
 * verb from `specnaut upgrade`; one with any other edit keeps its router.
 *
 * The router an older release installed is modelled as today's minus its
 * `kanban` row, recorded in the lock as what Specnaut last wrote.
 */

const ROUTER = ".claude/skills/task/SKILL.md";
const LOCAL = "| `kanban` | `../our-board/SKILL.md` | Our own board view |";

/** Init, then put an older router on disk with `LOCAL` in its kanban row's place. */
async function olderRouterWithLocalRow(dir: string, extra = ""): Promise<string> {
  const init = await runSpecnaut(["init", "--here", "--no-git", "--ai", "claude"], dir);
  assertEquals(init.code, 0, init.stderr);
  const bundled = await Deno.readTextFile(join(dir, ROUTER));
  const lines = bundled.split("\n");
  const at = lines.findIndex((l) => l.startsWith("| `kanban"));
  assert(at > 0, "the bundled router routes kanban");
  const older = lines.filter((_, i) => i !== at).join("\n");
  await Deno.writeTextFile(join(dir, ROUTER), lines.with(at, LOCAL).join("\n") + extra);
  const lockPath = join(dir, ".specnaut/installed.lock");
  const lock = parseLock(await Deno.readTextFile(lockPath));
  const entries = new Map(lock.entries);
  const entry = entries.get(ROUTER)!;
  entries.set(ROUTER, { ...entry, sha256: await sha256(older), templatesVersion: "0.0.1" });
  await Deno.writeTextFile(lockPath, serializeLock({ ...lock, entries }));
  return bundled;
}

Deno.test("a router whose only edit routes kanban locally is replaced by the bundled verb", async () => {
  await withTempDir(async (dir) => {
    const bundled = await olderRouterWithLocalRow(dir);
    // A note, not a refusal: `ℹ`, on the dry run and the applied run alike.
    const dry = await runSpecnaut(["upgrade", "--dry-run"], dir);
    assertStringIncludes(dry.stdout, `ℹ ${ROUTER}: the local row is dropped`);
    const up = await runSpecnaut(["upgrade"], dir);
    assertEquals(up.code, 0, up.stderr);
    assertEquals(await Deno.readTextFile(join(dir, ROUTER)), bundled);
    assertStringIncludes(up.stdout, `ℹ ${ROUTER}: the local row is dropped`);
    assertStringIncludes(up.stdout, "the bundled `kanban` takes over");
    assertStringIncludes(up.stdout, LOCAL);
  });
});

Deno.test("a router with any other edit stays a preserved customisation", async () => {
  await withTempDir(async (dir) => {
    await olderRouterWithLocalRow(dir, "\nHOUSE RULE: our own line\n");
    const before = await Deno.readTextFile(join(dir, ROUTER));
    const up = await runSpecnaut(["upgrade"], dir);
    assertEquals(up.code, 0, up.stderr);
    assertEquals(await Deno.readTextFile(join(dir, ROUTER)), before);
    assert(!up.stdout.includes("the local row is dropped"), up.stdout);
  });
});

Deno.test("a row added for a verb the router already routes is the project's own, kept", async () => {
  await withTempDir(async (dir) => {
    const init = await runSpecnaut(["init", "--here", "--no-git", "--ai", "claude"], dir);
    assertEquals(init.code, 0, init.stderr);
    const bundled = await Deno.readTextFile(join(dir, ROUTER));
    const own = "| `review --deep` | `../deep-review/SKILL.md` | Our deeper review |";
    const edited = bundled.replace(/^\| `review` .*$/m, (line) => `${line}\n${own}`);
    assert(edited !== bundled, "the bundled router routes review");
    await Deno.writeTextFile(join(dir, ROUTER), edited);
    const up = await runSpecnaut(["upgrade"], dir);
    assertEquals(up.code, 0, up.stderr);
    assertEquals(await Deno.readTextFile(join(dir, ROUTER)), edited, "the project's row was lost");
    assert(!up.stdout.includes("the local row is dropped"), up.stdout);
  });
});
