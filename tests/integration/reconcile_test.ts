import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { runReconcile } from "../../src/cli/handlers/reconcile_handler.ts";

async function withProject<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-reconcile-int-" });
  try {
    return await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("integration: reconcile --status lists staged paths", async () => {
  await withProject(async (dir) => {
    // Seed a fake staging entry directly:
    const stagingFile = resolve(dir, ".specnaut/upgrade-staging/.claude/agents/developer.md");
    await Deno.mkdir(resolve(stagingFile, ".."), { recursive: true });
    await Deno.writeTextFile(stagingFile, "UPSTREAM\n");

    // Run the handler in `dir`:
    const origCwd = Deno.cwd();
    Deno.chdir(dir);
    let captured = "";
    const orig = console.log;
    console.log = (s: string) => {
      captured += s + "\n";
    };
    try {
      const code = await runReconcile({ kind: "reconcile-status" });
      assertEquals(code, 0);
    } finally {
      console.log = orig;
      Deno.chdir(origCwd);
    }
    const parsed = JSON.parse(captured);
    assertEquals(parsed.pending, [".claude/agents/developer.md"]);
  });
});
