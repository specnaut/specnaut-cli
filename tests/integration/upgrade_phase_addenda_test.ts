import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { exists } from "@std/fs";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * #611 — the addendum survives, the phase doc keeps refreshing.
 *
 * Both halves in one run, because each alone is satisfied by the failure the
 * other catches: an addendum that "survives" an upgrade which refreshed nothing
 * proves no coexistence, and a refreshed phase doc says nothing about the file
 * beside it. The refresh is the ACs' reason for existing — before #611 the only
 * way to add one line to a phase was to preserve it, and a preserved phase stops
 * refreshing.
 *
 * Run on two harnesses whose phase docs live in unrelated trees. The addendum's
 * path is the same on both; that is the harness-invariance claim, and one
 * harness cannot test it.
 */

async function runSpecnaut(args: string[], cwd: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-phase-addenda-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** SHA-256 hex of a UTF-8 string — the lock's `sha256` format. */
async function sha256Hex(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Makes `dest` look like an older, UNMODIFIED bundled file: rewritten on disk,
 * with its lock SHA re-stamped to match. Disk == lock != bundle is exactly the
 * state the planner reads as "Specnaut shipped a newer version — refresh it",
 * produced without mutating the embedded bundle.
 */
async function ageBundledFile(dir: string, dest: string, olderContent: string) {
  await Deno.writeTextFile(join(dir, dest), olderContent);
  const lockPath = join(dir, ".specnaut/installed.lock");
  const yaml = await Deno.readTextFile(lockPath);
  const escaped = dest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^  ${escaped}:\\n    sha256: )[0-9a-f]+`, "m");
  const next = yaml.replace(re, `$1${await sha256Hex(olderContent)}`);
  if (next === yaml) throw new Error(`no lock entry for ${dest}`);
  await Deno.writeTextFile(lockPath, next);
}

/** Invented. Nothing here names a real project, tool or vendor. */
const ADDENDUM = "Before computing the tag, run `./scripts/check-pending-migrations.sh`.\n" +
  "If it reports a pending migration, stop and name it.\n";
const ADDENDUM_PATH = ".specnaut/addenda/ship/release.md";

const HARNESS_CASES = [
  { ai: "claude", phaseDoc: ".claude/skills/ship/phases/release.md" },
  { ai: "windsurf", phaseDoc: ".windsurf/workflows/specnaut-ship-release.md" },
] as const;

for (const { ai, phaseDoc } of HARNESS_CASES) {
  const INIT = ["init", "--here", "--no-git", "--ai", ai, "--backlog", "local"];

  Deno.test(`${ai}: upgrade refreshes the bundled phase doc AND leaves its addendum byte-identical`, async () => {
    await withTempDir(async (dir) => {
      assertEquals((await runSpecnaut(INIT, dir)).code, 0);
      const bundled = await Deno.readTextFile(join(dir, phaseDoc));
      assertStringIncludes(bundled, "# ", `${phaseDoc} was not scaffolded as a phase doc`);

      await Deno.mkdir(join(dir, ".specnaut/addenda/ship"), { recursive: true });
      await Deno.writeTextFile(join(dir, ADDENDUM_PATH), ADDENDUM);
      const OLDER = "# Release phase (an older bundled revision)\n";
      await ageBundledFile(dir, phaseDoc, OLDER);

      const up = await runSpecnaut(["upgrade"], dir);
      assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

      // The refresh: the phase doc is back to the bundle, not held at the old
      // revision. Without this the survival below proves nothing.
      assertEquals(
        await Deno.readTextFile(join(dir, phaseDoc)),
        bundled,
        "the phase doc was not refreshed — an addendum must not freeze the file it adds to",
      );
      // The survival: the addendum, untouched.
      assertEquals(await Deno.readTextFile(join(dir, ADDENDUM_PATH)), ADDENDUM);
      // Project-owned means Specnaut never adopts it: in the lock, a later
      // upgrade would classify it — and `--force` could overwrite it.
      const lock = await Deno.readTextFile(join(dir, ".specnaut/installed.lock"));
      assert(!lock.includes(".specnaut/addenda"), "the addendum was adopted into installed.lock");
      // And nothing is said about it: it is not a customization to warn on.
      assert(!up.stdout.includes("addenda"), `upgrade reported the addendum:\n${up.stdout}`);
    });
  });

  Deno.test(`${ai}: a forced refresh does not touch the addendum either`, async () => {
    // `init --force` overwrites every bundled file unconditionally — the path
    // that clobbers even a preserved-by-edit phase doc. The addendum is not a
    // bundled file, so it has nothing to overwrite.
    await withTempDir(async (dir) => {
      assertEquals((await runSpecnaut(INIT, dir)).code, 0);
      await Deno.mkdir(join(dir, ".specnaut/addenda/ship"), { recursive: true });
      await Deno.writeTextFile(join(dir, ADDENDUM_PATH), ADDENDUM);

      const forced = await runSpecnaut([...INIT, "--force"], dir);
      assertEquals(forced.code, 0, `init --force failed: ${forced.stderr}`);
      assertEquals(await Deno.readTextFile(join(dir, ADDENDUM_PATH)), ADDENDUM);

      const up = await runSpecnaut(["upgrade", "--force"], dir);
      assertEquals(up.code, 0, `upgrade --force failed: ${up.stderr}`);
      assertEquals(await Deno.readTextFile(join(dir, ADDENDUM_PATH)), ADDENDUM);
    });
  });

  Deno.test(`${ai}: a project with no addendum gets no addenda tree`, async () => {
    // AC: a missing addendum is a no-op. Scaffolding an empty directory — or a
    // placeholder file — would make the absent case look like a present one,
    // and a placeholder would be a Specnaut-owned file at a project-owned path.
    await withTempDir(async (dir) => {
      assertEquals((await runSpecnaut(INIT, dir)).code, 0);
      assertEquals((await runSpecnaut(["upgrade", "--force"], dir)).code, 0);
      assert(
        !(await exists(join(dir, ".specnaut/addenda"))),
        "init/upgrade created .specnaut/addenda — the seam must be opt-in by file",
      );
    });
  });
}

Deno.test("upgrade grafts the phase-addenda pointer into an AGENTS.md that predates it", async () => {
  // The only route by which an ALREADY-INSTALLED project learns the seam
  // exists on surfaces that bypass the router: `AGENTS.md` is skipIfExists.
  await withTempDir(async (dir) => {
    const own = "# AGENTS.md\n\n## House rules\n\nWe rebase.\n";
    await Deno.writeTextFile(join(dir, "AGENTS.md"), own);
    assertEquals(
      (await runSpecnaut(
        ["init", "--here", "--no-git", "--ai", "windsurf", "--backlog", "local"],
        dir,
      )).code,
      0,
    );
    const up = await runSpecnaut(["upgrade"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

    const after = await Deno.readTextFile(join(dir, "AGENTS.md"));
    const START = "<!-- --- Specnaut: phase-addenda --- -->";
    const END = "<!-- --- End Specnaut: phase-addenda --- -->";
    const body = after.slice(after.indexOf(START), after.indexOf(END));
    assert(after.includes(START) && after.includes(END), "no phase-addenda block");
    // The BODY, not the file — fences around nothing deliver no instruction.
    assertStringIncludes(body, ".specnaut/addenda/<skill>/<phase>.md");
    assertEquals(after.split(START).length - 1, 1, "grafted twice");
    assert(after.startsWith(own.trimEnd()), "the user's own content must stay the exact prefix");
  });
});
