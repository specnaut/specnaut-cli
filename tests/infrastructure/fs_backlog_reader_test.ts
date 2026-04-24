import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { FsBacklogReader } from "../../src/infrastructure/fs_backlog_reader.ts";

const FRONT = (id: string, status = "todo") =>
  `---
id: "${id}"
title: Task ${id}
category: devex
priority: medium
complexity: 3
status: ${status}
depends_on: []
spec: null
tags: []
created: 2026-04-24
---

Body ${id}
`;

async function withProjectDir(fn: (projectDir: string) => Promise<void>) {
  const projectDir = await Deno.makeTempDir({ prefix: "specflow-reader-" });
  await Deno.mkdir(join(projectDir, "tasks/backlog"), { recursive: true });
  try {
    await fn(projectDir);
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

Deno.test("FsBacklogReader.readAll returns tasks sorted by id", async () => {
  await withProjectDir(async (projectDir) => {
    await Deno.writeTextFile(join(projectDir, "tasks/backlog/002-second.md"), FRONT("002"));
    await Deno.writeTextFile(join(projectDir, "tasks/backlog/001-first.md"), FRONT("001"));
    const reader = new FsBacklogReader();
    const tasks = await reader.readAll(projectDir);
    assertEquals(tasks.map((t) => t.id), ["001", "002"]);
  });
});

Deno.test("FsBacklogReader.readAll skips non-matching filenames", async () => {
  await withProjectDir(async (projectDir) => {
    await Deno.writeTextFile(join(projectDir, "tasks/backlog/001-first.md"), FRONT("001"));
    await Deno.writeTextFile(join(projectDir, "tasks/backlog/README.md"), "# readme");
    await Deno.writeTextFile(join(projectDir, "tasks/backlog/notes.txt"), "text");
    const reader = new FsBacklogReader();
    const tasks = await reader.readAll(projectDir);
    assertEquals(tasks.length, 1);
    assertEquals(tasks[0].id, "001");
  });
});

Deno.test("FsBacklogReader.readAll returns empty array when dir missing", async () => {
  const reader = new FsBacklogReader();
  const tasks = await reader.readAll("/tmp/specflow-does-not-exist-12345");
  assertEquals(tasks, []);
});

Deno.test("FsBacklogReader.readOne returns null when id not present", async () => {
  await withProjectDir(async (projectDir) => {
    const reader = new FsBacklogReader();
    assertEquals(await reader.readOne(projectDir, "999"), null);
  });
});

Deno.test("FsBacklogReader.readOne finds task by id prefix", async () => {
  await withProjectDir(async (projectDir) => {
    await Deno.writeTextFile(join(projectDir, "tasks/backlog/042-answer.md"), FRONT("042"));
    const reader = new FsBacklogReader();
    const task = await reader.readOne(projectDir, "042");
    assertEquals(task?.id, "042");
  });
});
