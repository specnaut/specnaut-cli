import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { FsStagingStore } from "../../src/infrastructure/fs_staging_store.ts";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-staging-test-" });
  try {
    return await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function seed(projectDir: string, relPath: string, content: string) {
  const full = resolve(projectDir, ".specnaut/upgrade-staging", relPath);
  await Deno.mkdir(resolve(full, ".."), { recursive: true });
  await Deno.writeTextFile(full, content);
}

Deno.test("FsStagingStore.list: empty when no staging dir", async () => {
  await withTempDir(async (dir) => {
    const s = new FsStagingStore();
    assertEquals(await s.list(dir), []);
  });
});

Deno.test("FsStagingStore.list: returns project-relative paths", async () => {
  await withTempDir(async (dir) => {
    await seed(dir, ".claude/agents/developer.md", "UP\n");
    await seed(dir, ".claude/skills/specnaut/SKILL.md", "UP2\n");
    const s = new FsStagingStore();
    const got = (await s.list(dir)).sort();
    assertEquals(got, [
      ".claude/agents/developer.md",
      ".claude/skills/specnaut/SKILL.md",
    ]);
  });
});

Deno.test("FsStagingStore.read: returns content / null", async () => {
  await withTempDir(async (dir) => {
    await seed(dir, ".claude/agents/developer.md", "UP\n");
    const s = new FsStagingStore();
    assertEquals(await s.read(dir, ".claude/agents/developer.md"), "UP\n");
    assertEquals(await s.read(dir, "missing"), null);
  });
});

Deno.test("FsStagingStore.delete: removes file, idempotent", async () => {
  await withTempDir(async (dir) => {
    await seed(dir, ".claude/agents/developer.md", "UP\n");
    const s = new FsStagingStore();
    await s.delete(dir, ".claude/agents/developer.md");
    assertEquals(await s.read(dir, ".claude/agents/developer.md"), null);
    // No throw on second delete:
    await s.delete(dir, ".claude/agents/developer.md");
  });
});

Deno.test("FsStagingStore.cleanupIfEmpty: removes empty dir, returns true", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(resolve(dir, ".specnaut/upgrade-staging"), { recursive: true });
    const s = new FsStagingStore();
    assertEquals(await s.cleanupIfEmpty(dir), true);
  });
});

Deno.test("FsStagingStore.cleanupIfEmpty: returns false when non-empty", async () => {
  await withTempDir(async (dir) => {
    await seed(dir, ".claude/agents/developer.md", "UP\n");
    const s = new FsStagingStore();
    assertEquals(await s.cleanupIfEmpty(dir), false);
  });
});
