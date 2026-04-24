import { join } from "@std/path";
import { parseFrontmatter } from "../domain/backlog/frontmatter.ts";
import type { BacklogTask } from "../domain/backlog/task.ts";
import type { BacklogReader } from "../application/ports.ts";

const ENTRY_RE = /^(\d{3})-[\w.-]+\.md$/;

export class FsBacklogReader implements BacklogReader {
  async readAll(projectDir: string): Promise<BacklogTask[]> {
    const dir = join(projectDir, "tasks", "backlog");
    const tasks: BacklogTask[] = [];
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (!entry.isFile) continue;
        if (!ENTRY_RE.test(entry.name)) continue;
        const raw = await Deno.readTextFile(join(dir, entry.name));
        tasks.push(parseFrontmatter(raw));
      }
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return [];
      throw err;
    }
    tasks.sort((a, b) => a.id.localeCompare(b.id));
    return tasks;
  }

  async readOne(projectDir: string, id: string): Promise<BacklogTask | null> {
    const padded = id.padStart(3, "0");
    const dir = join(projectDir, "tasks", "backlog");
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (!entry.isFile) continue;
        if (!entry.name.startsWith(`${padded}-`)) continue;
        const raw = await Deno.readTextFile(join(dir, entry.name));
        return parseFrontmatter(raw);
      }
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
    return null;
  }
}
