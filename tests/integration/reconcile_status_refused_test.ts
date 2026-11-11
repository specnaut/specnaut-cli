import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runReconcile } from "../../src/cli/handlers/reconcile_handler.ts";
import { FsLockStore } from "../../src/infrastructure/fs_lock_store.ts";
import { makeLink, symlinkTest } from "../helpers/link_text.ts";

/**
 * A staged copy the store refuses to read (cli#765) is reported by
 * `reconcile --status`, never thrown: the upgrade walk parses that JSON, and an
 * uncaught refusal gave it a stack trace instead. `reconcile <path>` still refuses.
 */

const REL = "a/b/tool";
const PLAIN = ".claude/agents/developer.md";

async function seedLinkedLeaf(proj: string): Promise<void> {
  const staging = join(proj, ".specnaut/upgrade-staging");
  for (const rel of [REL, PLAIN]) {
    await Deno.mkdir(join(proj, rel, ".."), { recursive: true });
    await Deno.writeTextFile(join(proj, rel), "LOCAL\n");
    await Deno.mkdir(join(staging, rel, ".."), { recursive: true });
  }
  await Deno.writeTextFile(join(staging, PLAIN), "UPSTREAM\n");
  await Deno.mkdir(join(proj, "src"));
  await Deno.writeTextFile(join(proj, "src/tool.ts"), "user file\n");
  await makeLink(join(proj, "src/tool.ts"), join(staging, REL));
  const entry = {
    sha256: "old-sha",
    installedAt: "2026-01-01T00:00:00.000Z",
    templatesVersion: "1.4.0",
  };
  await new FsLockStore().write(proj, {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "1.6.0",
    entries: new Map([[REL, entry], [PLAIN, entry]]),
  });
}

/** Runs `--status` from `proj` and returns its exit code and what it printed on stdout. */
async function statusIn(proj: string): Promise<{ code: number; out: string }> {
  const cwd = Deno.cwd();
  const log = console.log;
  let out = "";
  console.log = (s: string) => void (out += s + "\n");
  Deno.chdir(proj);
  try {
    return { code: await runReconcile({ kind: "reconcile-status" }), out };
  } finally {
    console.log = log;
    Deno.chdir(cwd);
  }
}

symlinkTest("reconcile --status reports a staged link it refuses, in valid JSON", async () => {
  const proj = await Deno.makeTempDir({ prefix: "reconcile-status-refused-" });
  try {
    await seedLinkedLeaf(proj);
    const { code, out } = await statusIn(proj);
    assertEquals(code, 0);
    const parsed = JSON.parse(out);
    assertEquals(parsed.pending, [PLAIN]);
    assertEquals(parsed.refused.map((r: { path: string }) => r.path), [REL]);
    assertStringIncludes(parsed.refused[0].reason, "refusing to read a staged path");
    assertStringIncludes(parsed.refused[0].reason, "remove the link itself");
    assertEquals(await Deno.readTextFile(join(proj, "src/tool.ts")), "user file\n");
  } finally {
    await Deno.remove(proj, { recursive: true });
  }
});
