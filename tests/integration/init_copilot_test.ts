import { assertEquals } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

async function runSpecnaut(
  args: string[],
  opts: { cwd?: string } = {},
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
  const dir = await Deno.makeTempDir({ prefix: "specnaut-init-copilot-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specnaut init --ai copilot scaffolds a Copilot layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecnaut(
      ["init", "demo", "--no-git", "--ai", "copilot"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");

    // v1.0.0: router instruction + 11 phase instructions +
    // board + 9 agent instructions.
    assertEquals(
      await exists(join(root, ".github/instructions/specnaut.instructions.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".github/instructions/specnaut-task-plan.instructions.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".github/instructions/specnaut-task.instructions.md")),
      true,
    );
    // #409: the deprecated specnaut-auto alias no longer scaffolds.
    assertEquals(
      await exists(join(root, ".github/instructions/specnaut-auto.instructions.md")),
      false,
    );
    assertEquals(
      await exists(
        join(root, ".github/instructions/specnaut-agent-product-owner.instructions.md"),
      ),
      true,
    );

    // Frontmatter rewritten — applyTo: "**" present, Claude fields stripped
    const cmdContent = await Deno.readTextFile(
      join(root, ".github/instructions/specnaut.instructions.md"),
    );
    assertEquals(cmdContent.includes('applyTo: "**"'), true);
    assertEquals(cmdContent.includes("model: opus"), false);
    assertEquals(cmdContent.includes("tools:"), false);

    // One flat instruction file per bundled skill, phase document and agent.
    // The audit scope script ships under .specnaut/scripts/audit/, and
    // status-audit's schema doc to .specnaut/logs/README.md — neither is
    // flattened here.
    const instructionsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".github/instructions")),
    )).length;
    // 67 after spec 033 and the `upgrade` phase; 55 since spec 034 retired
    // seven skills and the five audit phases. 53 since cli#683: `board`,
    // `code-audit` and the five `*-audit` skills became one `task` skill, which
    // gained `backlog` and `audit` documents; `specnaut` gained `doc` and `list`.
    // 52 since cli#678: review-coordinator and test-reviewer retired, the
    // `task` skill gained the review-seats document. 46 since cli#678 retired
    // three undispatched agents and three contracts nothing parsed.
    assertEquals(instructionsCount, 46);

    // Shared (cross-harness)
    assertEquals(await exists(join(root, "docs/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), false);
    // These inits take the DEFAULT backend, which is `cloud` — so there is no
    // `.specnaut/backlog/NNN-slug.md` tree for this file to index. It shipped
    // anyway until #525, giving every non-local project a second, empty source
    // of truth for data that lives elsewhere. See init_backlog_test.ts for the
    // local case, where it belongs.
    assertEquals(await exists(join(root, ".specnaut/backlog.md")), false);

    // NOT emitted for copilot
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
    assertEquals(await exists(join(root, ".agents/")), false);
    assertEquals(await exists(join(root, ".codex/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects copilot
    const lock = await Deno.readTextFile(join(root, ".specnaut/installed.lock"));
    assertEquals(lock.includes("harness: copilot"), true);
  });
});
