import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * Spec 038 retired `.specnaut/templates/constitution-template.md` (FR-014): the
 * bootstrap at `docs/constitution.md` is the one constitution source. There is
 * no retirement mechanism — a lock entry the bundle no longer carries is an
 * orphan — so this proves the orphan path holds for this file: an untouched
 * copy goes, a customised one stays and is reported.
 */

const TEMPLATE = ".specnaut/templates/constitution-template.md";
const BODY = "# [PROJECT_NAME] Constitution\n\n## Core Principles\n";

async function runSpecnaut(args: string[], cwd: string, home: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    env: { HOME: home },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { code, out: d.decode(stdout) + d.decode(stderr) };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fresh init, then the template planted on disk and in the lock as 7.2 left it. */
async function withPlantedTemplate(
  onDisk: string,
  fn: (dir: string, home: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-retired-template-" });
  const home = await Deno.makeTempDir({ prefix: "specnaut-home-" });
  try {
    const init = await runSpecnaut(
      ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"],
      dir,
      home,
    );
    assertEquals(init.code, 0, init.out);
    assertEquals(await exists(join(dir, TEMPLATE)), false, "a fresh init wrote the template");
    await Deno.writeTextFile(join(dir, TEMPLATE), onDisk);
    const lockPath = join(dir, ".specnaut/installed.lock");
    await Deno.writeTextFile(
      lockPath,
      (await Deno.readTextFile(lockPath)) +
        `  ${TEMPLATE}:\n    sha256: ${await sha256(BODY)}\n` +
        `    installed_at: "2026-01-01T00:00:00Z"\n    templates_version: 7.2.0\n`,
    );
    await fn(dir, home);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
}

Deno.test("upgrade removes an untouched constitution-template.md and drops it from the lock", async () => {
  await withPlantedTemplate(BODY, async (dir, home) => {
    const up = await runSpecnaut(["upgrade"], dir, home);
    assertEquals(up.code, 0, up.out);
    assertEquals(await exists(join(dir, TEMPLATE)), false, "the vanilla template survived");
    const lock = await Deno.readTextFile(join(dir, ".specnaut/installed.lock"));
    assert(!lock.includes(`  ${TEMPLATE}:`), "the lock still records the template");
  });
});

Deno.test("upgrade keeps a customised constitution-template.md and says so", async () => {
  await withPlantedTemplate(BODY + "\nour own notes\n", async (dir, home) => {
    const up = await runSpecnaut(["upgrade"], dir, home);
    assertEquals(up.code, 0, up.out);
    assert(await exists(join(dir, TEMPLATE)), "a customised copy is the user's: kept");
    assertStringIncludes(up.out, `⚠ ${TEMPLATE}`);
    assertStringIncludes(up.out, "1 orphan-preserved");
  });
});
