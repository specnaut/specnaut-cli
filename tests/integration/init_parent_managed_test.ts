import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";
import { parseLock } from "../../src/domain/installed_lock.ts";

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

/**
 * Builds a providing-workspace fixture: a parent dir with `.specnaut/` and a
 * `deno.json` declaring `workspace: ["./child"]`, plus an (empty) child dir.
 * Returns canonical paths (macOS temp dirs symlink `/var`).
 */
async function providingFixture(
  opts: { childStandalone?: boolean } = {},
): Promise<{ root: string; parent: string; child: string }> {
  const root = await Deno.makeTempDir({ prefix: "specnaut-pm-" });
  const parent = join(root, "parent");
  const child = join(parent, "child");
  await Deno.mkdir(join(parent, ".specnaut"), { recursive: true });
  await Deno.mkdir(child, { recursive: true });
  await Deno.writeTextFile(
    join(parent, "deno.json"),
    JSON.stringify({ workspace: ["./child"] }, null, 2),
  );
  if (opts.childStandalone) {
    await Deno.mkdir(join(child, ".specnaut"), { recursive: true });
    await Deno.writeTextFile(join(child, ".specnaut", "standalone.yml"), "");
  }
  return { root, parent, child };
}

const NOTICE = "parent-managed workspace detected — skills/agents inherited from parent";

// C1 — SC-001, SC-006, FR-005/FR-006
Deno.test("parent-managed suppresses agentic", async () => {
  const { root, child } = await providingFixture();
  try {
    const { code, stdout, stderr } = await runSpecnaut(
      ["init", "--here", "--no-git"],
      { cwd: child },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    // Zero agentic files written.
    assertEquals(await exists(join(child, ".claude/skills")), false);
    assertEquals(await exists(join(child, ".claude/agents")), false);
    assertEquals(await exists(join(child, ".claude/commands")), false);

    // Toolkit still provisioned.
    assertEquals(await exists(join(child, ".specnaut/memory/constitution.md")), true);
    assertEquals(await exists(join(child, "AGENTS.md")), true);

    // Notice printed exactly once.
    assertStringIncludes(stdout, NOTICE);
    assertEquals(stdout.split(NOTICE).length - 1, 1);

    // Lock records the parent-managed decision and carries zero agentic
    // entries (FR-012) — close the invariant at the init integration layer.
    const lock = parseLock(await Deno.readTextFile(join(child, ".specnaut/installed.lock")));
    assertEquals(lock.parentManaged, true);
    for (const dest of lock.entries.keys()) {
      assert(
        !dest.startsWith(".claude/skills") &&
          !dest.startsWith(".claude/agents") &&
          !dest.startsWith(".claude/commands"),
        `agentic entry leaked into lock: ${dest}`,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// C2 — SC-002, FR-009/FR-010
Deno.test("standalone provisions normally", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-pm-standalone-" });
  try {
    const { code, stdout, stderr } = await runSpecnaut(
      ["init", "--here", "--no-git"],
      { cwd: dir },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    // Full agentic provisioning.
    assertEquals(await exists(join(dir, ".claude/skills/specnaut/SKILL.md")), true);
    assertEquals(await exists(join(dir, ".claude/agents/developer.md")), true);
    assertEquals(await exists(join(dir, ".claude/commands/specnaut.md")), true);
    assertEquals(await exists(join(dir, ".specnaut/memory/constitution.md")), true);

    // No notice on the standalone path.
    assert(!stdout.includes(NOTICE), "standalone init must not print the notice");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// C2 variant — enclosing Deno workspace that is NOT a providing Specnaut
// workspace (no .specnaut/ at the ancestor) ⇒ detection negative.
Deno.test("non-providing ancestor", async () => {
  const root = await Deno.makeTempDir({ prefix: "specnaut-pm-nonprov-" });
  const parent = join(root, "parent");
  const child = join(parent, "child");
  await Deno.mkdir(child, { recursive: true });
  // Parent declares the member but has NO .specnaut/ → not a provider.
  await Deno.writeTextFile(
    join(parent, "deno.json"),
    JSON.stringify({ workspace: ["./child"] }, null, 2),
  );
  try {
    const { code, stdout, stderr } = await runSpecnaut(
      ["init", "--here", "--no-git"],
      { cwd: child },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);
    // Detection negative ⇒ full provisioning, no notice.
    assertEquals(await exists(join(child, ".claude/skills/specnaut/SKILL.md")), true);
    assertEquals(await exists(join(child, ".claude/agents/developer.md")), true);
    assert(!stdout.includes(NOTICE));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// C4 — SC-004, FR-008
Deno.test("override forces full", async () => {
  const { root, child } = await providingFixture({ childStandalone: true });
  try {
    const { code, stdout, stderr } = await runSpecnaut(
      ["init", "--here", "--no-git"],
      { cwd: child },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);
    // standalone.yml override ⇒ full provisioning despite the providing parent.
    assertEquals(await exists(join(child, ".claude/skills/specnaut/SKILL.md")), true);
    assertEquals(await exists(join(child, ".claude/agents/developer.md")), true);
    assertEquals(await exists(join(child, ".claude/commands/specnaut.md")), true);
    assert(!stdout.includes(NOTICE), "override path must not print the notice");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
