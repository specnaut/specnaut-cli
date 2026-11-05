import { assertEquals, assertStringIncludes } from "@std/assert";
import { resolve } from "@std/path";
import { runReconcile } from "../../src/cli/handlers/reconcile_handler.ts";
import { FsLockStore } from "../../src/infrastructure/fs_lock_store.ts";
import { WINDOWS } from "../helpers/link_text.ts";
import { RUNS_AS_ROOT } from "../helpers/posix_modes.ts";

async function withProject<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-reconcile-int-" });
  try {
    return await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("integration: reconcile --status lists the staged paths reconcile can resolve", async () => {
  await withProject(async (dir) => {
    // A tracked file with a staged copy is pending. A staged copy the lock does
    // not track is not: `reconcile <path>` refuses it, so listing it made a
    // queue no command could empty (#613).
    const tracked = ".claude/agents/developer.md";
    for (const rel of [tracked, "AGENTS.md"]) {
      const stagingFile = resolve(dir, ".specnaut/upgrade-staging", rel);
      await Deno.mkdir(resolve(stagingFile, ".."), { recursive: true });
      await Deno.writeTextFile(stagingFile, "UPSTREAM\n");
      await Deno.mkdir(resolve(dir, rel, ".."), { recursive: true });
      await Deno.writeTextFile(resolve(dir, rel), "LOCAL\n");
    }
    await new FsLockStore().write(dir, {
      version: 2,
      harness: "claude",
      backlogBackend: "local",
      versionScheme: "semver",
      specBackend: "local",
      templatesVersion: "1.6.0",
      entries: new Map([[tracked, {
        sha256: "old-sha",
        installedAt: "2026-01-01T00:00:00.000Z",
        templatesVersion: "1.4.0",
      }]]),
    });

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
    assertEquals(parsed.pending, [tracked]);
  });
});

/** A tracked file with a staged copy, in `sub/`, whose staged folder refuses to be read. */
async function seedUnreadableStagedFolder(dir: string, rel: string): Promise<string> {
  const sub = resolve(dir, ".specnaut/upgrade-staging/sub");
  await Deno.mkdir(sub, { recursive: true });
  await Deno.writeTextFile(resolve(sub, "x.md"), "UPSTREAM\n");
  await Deno.mkdir(resolve(dir, "sub"));
  await Deno.writeTextFile(resolve(dir, rel), "LOCAL\n");
  await new FsLockStore().write(dir, {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "1.6.0",
    entries: new Map([[rel, {
      sha256: "old-sha",
      installedAt: "2026-01-01T00:00:00.000Z",
      templatesVersion: "1.4.0",
    }]]),
  });
  await Deno.chmod(sub, 0o300);
  return sub;
}

/** Runs `fn` from `dir`, and returns what it said on stderr. */
async function stderrInProject(dir: string, fn: () => Promise<void>): Promise<string> {
  const origCwd = Deno.cwd();
  const orig = console.error;
  let said = "";
  console.error = (s: string) => {
    said += s + "\n";
  };
  Deno.chdir(dir);
  try {
    await fn();
  } finally {
    console.error = orig;
    Deno.chdir(origCwd);
  }
  return said;
}

Deno.test({
  name: "integration: reconcile <path> succeeds and says which folder it could not tidy",
  ignore: WINDOWS || RUNS_AS_ROOT, // POSIX modes: how the folder refuses to be read.
  fn: () =>
    withProject(async (dir) => {
      const rel = "sub/x.md";
      const sub = await seedUnreadableStagedFolder(dir, rel);
      try {
        const said = await stderrInProject(dir, async () => {
          const intent = { kind: "reconcile-path", path: rel, mode: "accept-upstream" } as const;
          assertEquals(await runReconcile(intent), 0);
        });
        assertEquals(await Deno.readTextFile(resolve(dir, rel)), "UPSTREAM\n");
        assertStringIncludes(said, "could not remove the emptied folder");
        assertStringIncludes(said, ".specnaut/upgrade-staging/sub");
      } finally {
        await Deno.chmod(sub, 0o755);
      }
    }),
});
