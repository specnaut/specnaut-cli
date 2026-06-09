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
  const dir = await Deno.makeTempDir({ prefix: "specflow-preserve-integ-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const PRESERVED = ".claude/agents/product-owner.md";
// A managed file NOT declared preserved — must still be refreshed by --force.
const REFRESHED = ".claude/agents/code-reviewer.md";
const CUSTOM_MARK = "\n# my project-specific PO config — DO NOT CLOBBER\n";

/**
 * Init a project, customise the product-owner agent, and declare it preserved.
 * Returns the project dir and the byte-exact customised content so callers can
 * assert byte-identity after a forced refresh.
 */
async function initWithDeclaredCustomisation(
  parent: string,
): Promise<{ projectDir: string; customised: string }> {
  const init = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
  assertEquals(init.code, 0, `init precondition failed: ${init.stderr}`);
  const projectDir = join(parent, "demo");

  const poPath = join(projectDir, PRESERVED);
  const original = await Deno.readTextFile(poPath);
  const customised = original + CUSTOM_MARK;
  await Deno.writeTextFile(poPath, customised);

  await Deno.writeTextFile(
    join(projectDir, ".specflow/preserve.yml"),
    `preserved:\n  - ${PRESERVED}\n`,
  );
  return { projectDir, customised };
}

// T011 / C6 — SC-001, SC-002, SC-006: a declared file survives `init --force`
// byte-identical and emits a per-file notice; a non-declared managed file is
// still refreshed. Closes the 2026-06-08 product-owner.md regression.
Deno.test("init --force preserves a declared file byte-identical and emits a notice", async () => {
  await withTempDir(async (parent) => {
    const { projectDir, customised } = await initWithDeclaredCustomisation(parent);

    // Mutate a NON-declared managed file so we can prove --force still refreshes it.
    const refreshedPath = join(projectDir, REFRESHED);
    await Deno.writeTextFile(refreshedPath, "# clobbered locally\n");

    const refresh = await runSpecflow(["init", "--here", "--force", "--no-git"], {
      cwd: projectDir,
    });
    assertEquals(refresh.code, 0, refresh.stderr);

    // SC-001 / SC-006: the declared file is byte-identical to its pre-refresh content.
    const afterPo = await Deno.readTextFile(join(projectDir, PRESERVED));
    assertEquals(afterPo, customised, "declared file must survive --force byte-identical");

    // SC-002: a per-file preserve notice names the path.
    assertStringIncludes(refresh.stdout, `preserved ${PRESERVED}`);

    // The non-declared managed file IS refreshed (our local edit is gone).
    const afterRefreshed = await Deno.readTextFile(refreshedPath);
    assertEquals(
      afterRefreshed.includes("# clobbered locally"),
      false,
      "a non-declared managed file must be refreshed by --force",
    );
  });
});

// T016 / C6 — SC-005: `init --force --reset-preserved` overwrites the declared
// file AND emits a per-file override warning; the same run WITHOUT the flag
// preserves it (the opt-out is never the default).
Deno.test("init --force --reset-preserved overwrites the declared file and warns; no flag preserves", async () => {
  await withTempDir(async (parent) => {
    const { projectDir, customised } = await initWithDeclaredCustomisation(parent);

    // Control: without --reset-preserved the customisation survives.
    const keep = await runSpecflow(["init", "--here", "--force", "--no-git"], {
      cwd: projectDir,
    });
    assertEquals(keep.code, 0, keep.stderr);
    assertEquals(
      await Deno.readTextFile(join(projectDir, PRESERVED)),
      customised,
      "without --reset-preserved the declaration must be honoured",
    );

    // With --reset-preserved the bundled version is restored and the override warned.
    const reset = await runSpecflow(
      ["init", "--here", "--force", "--reset-preserved", "--no-git"],
      { cwd: projectDir },
    );
    assertEquals(reset.code, 0, reset.stderr);

    const afterReset = await Deno.readTextFile(join(projectDir, PRESERVED));
    assert(
      !afterReset.includes("DO NOT CLOBBER"),
      "with --reset-preserved the customisation must be overwritten by the bundle",
    );
    assertStringIncludes(reset.stdout, `override ${PRESERVED}`);
  });
});

// T011 control — FR-011: a project with no preserve.yml observes today's
// behaviour: the customised file is clobbered by --force (no preserve notice).
Deno.test("init --force without a preserve.yml clobbers a customised file (FR-011 control)", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(init.code, 0, init.stderr);
    const projectDir = join(parent, "demo");

    const poPath = join(projectDir, PRESERVED);
    await Deno.writeTextFile(poPath, (await Deno.readTextFile(poPath)) + CUSTOM_MARK);

    const refresh = await runSpecflow(["init", "--here", "--force", "--no-git"], {
      cwd: projectDir,
    });
    assertEquals(refresh.code, 0, refresh.stderr);
    const after = await Deno.readTextFile(poPath);
    assertEquals(
      after.includes("DO NOT CLOBBER"),
      false,
      "with no preserve.yml the customisation is clobbered (today's behaviour)",
    );
    assertEquals(
      refresh.stdout.includes("preserved "),
      false,
      "no preserve notice when nothing is declared",
    );
  });
});
