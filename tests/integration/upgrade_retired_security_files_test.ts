import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";
import { lockText, plant } from "./_lock_fixture.ts";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * Spec 044 retired the two files Claude projects got for the official
 * `security-guidance` plugin (cli#679). Specnaut's hooks and settings read
 * neither. They sit directly in `.claude/`, under no managed root, so they
 * leave through upgrade's lock-driven orphan path only because Claude's
 * `managedFiles` names them exactly. These tests prove the files go, that a
 * customised copy is kept until `--force`, and that naming two files did not
 * widen the scope to the rest of `.claude/`: a vanilla lock row for
 * `.claude/settings.json` is still refused.
 *
 * `alias-example` needs no case here: no released manifest ever installed it,
 * so no lock can carry it. Its absence is pinned in `manifest_registration_test`.
 */

const RETIRED = [".claude/claude-security-guidance.md", ".claude/security-patterns.yaml"] as const;
const SETTINGS = ".claude/settings.json";
const CONTEXT_LINK = ".claude/CLAUDE.md";

async function runSpecnaut(args: string[], cwd: string, home: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    env: { HOME: home, NO_COLOR: "1" }, // a throwaway HOME: no plugin installed
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { code, out: d.decode(stdout) + d.decode(stderr) };
}

async function withProject(
  harness: "claude",
  body: (dir: string, home: string) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: `specnaut-security-${harness}-` });
  const home = await Deno.makeTempDir({ prefix: "specnaut-home-" });
  try {
    const init = await runSpecnaut(
      ["init", "--here", "--no-git", "--ai", harness, "--backlog", "local"],
      dir,
      home,
    );
    assertEquals(init.code, 0, init.out);
    await body(dir, home);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
}

/** What an older release left: each file on disk, recorded in the lock with the sha of its body. */
const bodyOf = (rel: string) => `# ${rel}\nas an older Specnaut release wrote it\n`;
const plantRetired = (dir: string) =>
  plant(dir, RETIRED.map((rel) => [rel, bodyOf(rel), bodyOf(rel)]));

// Claude only: Codex never received these files, so a Codex case could not
// fail whatever regressed (cli#713).
Deno.test("[claude] a fresh init writes neither security-guidance file", async () => {
  await withProject("claude", async (dir) => {
    for (const rel of RETIRED) {
      assertEquals(await exists(join(dir, rel)), false, `fresh init wrote retired ${rel}`);
      assert(!(await lockText(dir)).includes(`  ${rel}:`), `the lock records retired ${rel}`);
    }
  });
});

Deno.test("[claude] upgrade prunes both vanilla files and leaves the rest of .claude/ alone", async () => {
  await withProject("claude", async (dir, home) => {
    await plantRetired(dir);
    // A vanilla lock row for settings.json: a `.claude/` prefix root would make
    // it a clean orphan and delete it with no backup. Exact names must not.
    const settings = await Deno.readTextFile(join(dir, SETTINGS));
    await plant(dir, [[SETTINGS, settings, settings]]);
    const link = await Deno.readLink(join(dir, CONTEXT_LINK));
    const agentsMd = await Deno.readTextFile(join(dir, "AGENTS.md"));

    const up = await runSpecnaut(["upgrade"], dir, home);
    assertEquals(up.code, 0, up.out);
    for (const rel of RETIRED) {
      assertEquals(await exists(join(dir, rel)), false, `${rel} survived the upgrade`);
      assert(!(await lockText(dir)).includes(`  ${rel}:`), `${rel} is still in the lock`);
    }
    assertStringIncludes(up.out, "2 removed, 0 orphan-preserved, 1 untracked");
    assertEquals(await Deno.readTextFile(join(dir, SETTINGS)), settings, `touched ${SETTINGS}`);
    assertStringIncludes(up.out, `⚠ ${SETTINGS} (outside the managed folders)`);
    assertEquals(await Deno.readLink(join(dir, CONTEXT_LINK)), link, `touched ${CONTEXT_LINK}`);
    assertEquals(await Deno.readTextFile(join(dir, "AGENTS.md")), agentsMd, "touched AGENTS.md");
  });
});

Deno.test("[claude] a customised security file is kept and warned until --force backs it up", async () => {
  await withProject("claude", async (dir, home) => {
    await plantRetired(dir);
    const [kept, vanilla] = RETIRED;
    await Deno.writeTextFile(join(dir, kept), bodyOf(kept) + "- my own rule\n");

    const up = await runSpecnaut(["upgrade"], dir, home);
    assertEquals(up.code, 0, up.out);
    assertEquals(await exists(join(dir, vanilla)), false, `${vanilla} survived the upgrade`);
    assert(await exists(join(dir, kept)), "a customised copy is the user's: kept");
    assertStringIncludes(up.out, `⚠ ${kept}`);
    assertStringIncludes(up.out, "1 orphan-preserved");

    const forced = await runSpecnaut(["upgrade", "--force"], dir, home);
    assertEquals(forced.code, 0, forced.out);
    assertEquals(await exists(join(dir, kept)), false, "--force left the customised copy");
    assertStringIncludes(
      await Deno.readTextFile(join(dir, `${kept}.specnaut.bak`)),
      "my own rule",
    );
    assertStringIncludes(forced.out, `backed up ${kept}`);
  });
});

Deno.test("[claude] a security file declared in preserve.yml is kept, not called unmanaged", async () => {
  // The preserve resolver used to scope lock keys by managed roots alone, so a
  // retired file admitted by exact name was warned "not a managed file" and then
  // deleted as an ordinary orphan — the declaration never reached the disk.
  await withProject("claude", async (dir, home) => {
    await plantRetired(dir);
    const [declared] = RETIRED;
    await Deno.writeTextFile(join(dir, ".specnaut/preserve.yml"), `preserved:\n  - ${declared}\n`);

    const up = await runSpecnaut(["upgrade"], dir, home);
    assertEquals(up.code, 0, up.out);
    assert(await exists(join(dir, declared)), `declared ${declared} was deleted`);
    assert(!up.out.includes("not a managed file"), `declared path called unmanaged:\n${up.out}`);
  });
});
