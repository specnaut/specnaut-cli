import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

async function runSpecflow(
  args: string[],
  opts: { cwd: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      MAIN,
      ...args,
    ],
    cwd: opts.cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await p.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specflow-upgrade-preserve-integ-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** SHA-256 hex of a UTF-8 string — matches the lock's `sha256` format. */
async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Re-stamp the lock SHA for a single managed dest to match arbitrary content.
 *
 * After init, every managed file's on-disk SHA equals its lock SHA equals the
 * bundle SHA. To simulate "the bundle ships a NEWER version of this file" WITHOUT
 * mutating the embedded bundle, we instead rewrite the file on disk to known
 * content and re-stamp its lock SHA to that content. The file is then "vanilla"
 * (disk == lock) yet diverges from the real bundle — exactly the state the
 * upgrade planner reads as an available auto-update for that dest.
 */
async function restampLockSha(
  projectDir: string,
  dest: string,
  newSha: string,
): Promise<void> {
  const lockPath = join(projectDir, ".specflow/installed.lock");
  const yaml = await Deno.readTextFile(lockPath);
  // Match the entry block for `dest` (YAML key) and replace its sha256 line.
  const escaped = dest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^  ${escaped}:\\n    sha256: )[0-9a-f]+`, "m");
  const next = yaml.replace(re, `$1${newSha}`);
  if (next === yaml) {
    throw new Error(`failed to re-stamp lock SHA for ${dest} (entry not found)`);
  }
  await Deno.writeTextFile(lockPath, next);
}

const DECLARED = ".claude/agents/product-owner.md";
const UNDECLARED = ".claude/agents/code-reviewer.md";
const CUSTOM_MARK = "\n# my project-specific config — DO NOT CLOBBER\n";

/**
 * HIGH-2 — end-to-end coverage for `upgrade` honouring a declared preserve.
 *
 * Distinct seam from init: init loads preserves as a `preservedPaths` Set,
 * whereas upgrade threads an `isDeclaredPreserved` predicate through
 * computeUpgradePlan. This test drives the real binary (handler →
 * UpgradeProjectUseCase → computeUpgradePlan) against a real fs + real
 * FsPreserveStore so a wiring regression in upgrade_handler.ts would be
 * caught (it would not be by the init integration test).
 *
 * Fixture: an installed project where a customised+declared file looks vanilla
 * vs its lock but diverges from the bundle (the bundle effectively ships a
 * newer version). Expectation: `specflow upgrade` leaves the declared file
 * byte-identical AND prints the "preserved … declared in .specflow/preserve.yml"
 * notice, while a non-declared customised file follows normal upgrade rules.
 */
Deno.test("upgrade honours a declared preserve end-to-end: declared file untouched, notice emitted", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(init.code, 0, `init precondition failed: ${init.stderr}`);
    const projectDir = join(parent, "demo");

    // Customise the declared file and re-stamp its lock SHA so it reads as
    // vanilla-but-diverged-from-bundle (an available auto-update the bundle ships).
    const declaredPath = join(projectDir, DECLARED);
    const declaredContent = (await Deno.readTextFile(declaredPath)) + CUSTOM_MARK;
    await Deno.writeTextFile(declaredPath, declaredContent);
    await restampLockSha(projectDir, DECLARED, await sha256Hex(declaredContent));

    // Same treatment for a NON-declared file — it must still be refreshed.
    const undeclaredPath = join(projectDir, UNDECLARED);
    const undeclaredContent = (await Deno.readTextFile(undeclaredPath)) + CUSTOM_MARK;
    await Deno.writeTextFile(undeclaredPath, undeclaredContent);
    await restampLockSha(projectDir, UNDECLARED, await sha256Hex(undeclaredContent));

    // Declare ONLY the first file preserved.
    await Deno.writeTextFile(
      join(projectDir, ".specflow/preserve.yml"),
      `preserved:\n  - ${DECLARED}\n`,
    );

    const upgrade = await runSpecflow(["upgrade"], { cwd: projectDir });
    assertEquals(upgrade.code, 0, upgrade.stderr);

    // The declared file is left byte-identical to its customised content.
    assertEquals(
      await Deno.readTextFile(declaredPath),
      declaredContent,
      "declared file must survive upgrade byte-identical",
    );
    // The declared-preserve notice names the path and the manifest.
    assertStringIncludes(
      upgrade.stdout,
      `preserved ${DECLARED} — declared in .specflow/preserve.yml`,
    );

    // The non-declared file follows normal upgrade behaviour: vanilla vs lock
    // but diverged from the bundle ⇒ auto-updated, so the local mark is gone.
    const afterUndeclared = await Deno.readTextFile(undeclaredPath);
    assert(
      !afterUndeclared.includes("DO NOT CLOBBER"),
      "a non-declared file must follow normal upgrade rules (refreshed from the bundle)",
    );
  });
});

/**
 * `--reset-preserved` opt-out on the upgrade path: the declared file is no
 * longer preserved and follows normal upgrade rules, with a per-file override
 * line. Proves the predicate is forced off when the flag is present.
 */
Deno.test("upgrade --reset-preserved overrides a declaration and refreshes the file", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(init.code, 0, `init precondition failed: ${init.stderr}`);
    const projectDir = join(parent, "demo");

    const declaredPath = join(projectDir, DECLARED);
    const declaredContent = (await Deno.readTextFile(declaredPath)) + CUSTOM_MARK;
    await Deno.writeTextFile(declaredPath, declaredContent);
    await restampLockSha(projectDir, DECLARED, await sha256Hex(declaredContent));

    await Deno.writeTextFile(
      join(projectDir, ".specflow/preserve.yml"),
      `preserved:\n  - ${DECLARED}\n`,
    );

    const upgrade = await runSpecflow(["upgrade", "--reset-preserved"], {
      cwd: projectDir,
    });
    assertEquals(upgrade.code, 0, upgrade.stderr);

    // With --reset-preserved the declaration is ignored: the file is refreshed
    // and a per-file override line is printed.
    const after = await Deno.readTextFile(declaredPath);
    assert(
      !after.includes("DO NOT CLOBBER"),
      "with --reset-preserved the declared file follows normal upgrade rules",
    );
    assertStringIncludes(upgrade.stdout, `override ${DECLARED}`);
  });
});
