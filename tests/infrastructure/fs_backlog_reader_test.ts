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

async function withTasksDir(fn: (dir: string) => Promise<void>) {
  const root = await Deno.makeTempDir({ prefix: "specflow-reader-" });
  const tasksDir = join(root, "tasks");
  await Deno.mkdir(join(tasksDir, "backlog"), { recursive: true });
  try {
    await fn(tasksDir);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("FsBacklogReader.readAll returns tasks sorted by id", async () => {
  await withTasksDir(async (tasksDir) => {
    await Deno.writeTextFile(join(tasksDir, "backlog/002-second.md"), FRONT("002"));
    await Deno.writeTextFile(join(tasksDir, "backlog/001-first.md"), FRONT("001"));
    const reader = new FsBacklogReader();
    const tasks = await reader.readAll(tasksDir);
    assertEquals(tasks.map((t) => t.id), ["001", "002"]);
  });
});

Deno.test("FsBacklogReader.readAll skips non-matching filenames", async () => {
  await withTasksDir(async (tasksDir) => {
    await Deno.writeTextFile(join(tasksDir, "backlog/001-first.md"), FRONT("001"));
    await Deno.writeTextFile(join(tasksDir, "backlog/README.md"), "# readme");
    await Deno.writeTextFile(join(tasksDir, "backlog/notes.txt"), "text");
    const reader = new FsBacklogReader();
    const tasks = await reader.readAll(tasksDir);
    assertEquals(tasks.length, 1);
    assertEquals(tasks[0].id, "001");
  });
});

Deno.test("FsBacklogReader.readAll returns empty array when dir missing", async () => {
  const reader = new FsBacklogReader();
  const tasks = await reader.readAll("/tmp/does/not/exist");
  assertEquals(tasks, []);
});

Deno.test("FsBacklogReader.readOne returns null when id not present", async () => {
  await withTasksDir(async (tasksDir) => {
    const reader = new FsBacklogReader();
    assertEquals(await reader.readOne(tasksDir, "999"), null);
  });
});

Deno.test("FsBacklogReader.readOne finds task by id prefix", async () => {
  await withTasksDir(async (tasksDir) => {
    await Deno.writeTextFile(join(tasksDir, "backlog/042-answer.md"), FRONT("042"));
    const reader = new FsBacklogReader();
    const task = await reader.readOne(tasksDir, "042");
    assertEquals(task?.id, "042");
  });
});
