import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * Spec 034 retired a second, derived workflow: seven standalone skills, the
 * `.specnaut/harness-tools.md` mapping they fed, and the five
 * `/specnaut audit <axis>` phase documents.
 *
 * There is deliberately no retirement mechanism. A lock entry the new bundle
 * no longer carries is an orphan, and upgrade's orphan path removes it. These
 * tests prove that holds for THIS set, on two harnesses whose layouts differ,
 * because "the mechanism is generic so it must work" is the assumption that
 * would leave a project with a stale skill an agent can still load.
 *
 * The paths are what a 6.0.0 init actually wrote, captured before the files
 * left the bundle. That is not a registry: nothing outside this test reads it.
 */

const SKILLS = [
  "brainstorming",
  "writing-plans",
  "executing-plans",
  "subagent-driven-development",
  "requesting-code-review",
  "verification-before-completion",
  "using-specnaut",
] as const;
const AXES = ["security", "performance", "accessibility", "architecture", "dependencies"] as const;

const LAYOUT = {
  claude: {
    skill: (n: string) => `.claude/skills/${n}/SKILL.md`,
    phases: ".claude/skills/specnaut/phases",
  },
  codex: {
    skill: (n: string) => `.agents/skills/specnaut-${n}/SKILL.md`,
    phases: ".agents/skills/specnaut/phases",
  },
} as const;
type Harness = keyof typeof LAYOUT;

function retiredPaths(h: Harness): string[] {
  const l = LAYOUT[h];
  return [
    ...SKILLS.map(l.skill),
    ...AXES.map((a) => `${l.phases}/audit-${a}.md`),
    ".specnaut/harness-tools.md",
  ];
}

async function runSpecnaut(args: string[], cwd: string, home: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    // A throwaway HOME: the plugin detector reads it, and `check --project` must
    // see a Claude project with NO plugin installed — the case that warned.
    env: { HOME: home },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { code, stdout: d.decode(stdout), stderr: d.decode(stderr) };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const BODY = "# a document this version no longer ships\n";

/** Init `h`, then plant the retired files on disk AND in the lock, as 6.0.0 left them. */
async function sixOhProject(h: Harness): Promise<{ dir: string; home: string }> {
  const dir = await Deno.makeTempDir({ prefix: `specnaut-retired-${h}-` });
  const home = await Deno.makeTempDir({ prefix: "specnaut-home-" });
  const init = await runSpecnaut(
    ["init", "--here", "--no-git", "--ai", h, "--backlog", "local"],
    dir,
    home,
  );
  assertEquals(init.code, 0, `init failed: ${init.stderr}`);
  const lockPath = join(dir, ".specnaut/installed.lock");
  let lock = await Deno.readTextFile(lockPath);
  const hash = await sha256(BODY);
  for (const rel of retiredPaths(h)) {
    await Deno.mkdir(join(dir, rel, ".."), { recursive: true });
    await Deno.writeTextFile(join(dir, rel), BODY);
    lock += `  ${rel}:\n    sha256: ${hash}\n    installed_at: "2026-01-01T00:00:00Z"\n` +
      `    templates_version: 6.0.0\n`;
  }
  await Deno.writeTextFile(lockPath, lock);
  return { dir, home };
}

async function cleanup(...dirs: string[]) {
  for (const d of dirs) await Deno.remove(d, { recursive: true });
}

for (const h of ["claude", "codex"] as const) {
  Deno.test(`[${h}] a fresh init writes none of the retired workflow`, async () => {
    const dir = await Deno.makeTempDir({ prefix: `specnaut-fresh-${h}-` });
    const home = await Deno.makeTempDir({ prefix: "specnaut-home-" });
    try {
      const init = await runSpecnaut(
        ["init", "--here", "--no-git", "--ai", h, "--backlog", "local"],
        dir,
        home,
      );
      assertEquals(init.code, 0, init.stderr);
      for (const rel of retiredPaths(h)) {
        assertEquals(await exists(join(dir, rel)), false, `fresh init wrote retired ${rel}`);
      }
      // The surviving workflow is there: the absence above is not an empty init.
      assert(await exists(join(dir, `${LAYOUT[h].phases}/plan.md`)), "plan phase missing");
    } finally {
      await cleanup(dir, home);
    }
  });

  Deno.test(`[${h}] upgrade removes the untouched copies, keeps a customised one, and stays clean`, async () => {
    const { dir, home } = await sixOhProject(h);
    try {
      const kept = LAYOUT[h].skill("writing-plans");
      await Deno.writeTextFile(join(dir, kept), BODY + "\nmy own notes\n");

      const up = await runSpecnaut(["upgrade"], dir, home);
      assertEquals(up.code, 0, up.stdout + up.stderr);
      for (const rel of retiredPaths(h).filter((p) => p !== kept)) {
        assertEquals(await exists(join(dir, rel)), false, `${rel} survived the upgrade`);
      }
      assert(
        await exists(join(dir, kept)),
        "a customised copy is the user's: kept without --force",
      );
      // Reported in the orphan-preserved group, with the marker the handler prints.
      assertStringIncludes(up.stdout + up.stderr, `⚠ ${kept}`);
      assertStringIncludes(up.stdout + up.stderr, "1 orphan-preserved");

      const lock = await Deno.readTextFile(join(dir, ".specnaut/installed.lock"));
      for (const rel of retiredPaths(h).filter((p) => p !== kept)) {
        assert(!lock.includes(`  ${rel}:`), `the lock still records the removed ${rel}`);
      }

      const again = await runSpecnaut(["upgrade"], dir, home);
      assertEquals(again.code, 0, again.stderr);
      for (const rel of retiredPaths(h).filter((p) => p !== kept)) {
        assertEquals(await exists(join(dir, rel)), false, `a second upgrade reinstated ${rel}`);
      }
    } finally {
      await cleanup(dir, home);
    }
  });
}

Deno.test("[claude] check --project reports no retired path as missing, removed by upgrade or by hand", async () => {
  const { dir, home } = await sixOhProject("claude");
  try {
    // By hand: the files go, the lock still lists them — the 6.0.0 state that warned.
    for (const rel of retiredPaths("claude")) await Deno.remove(join(dir, rel));
    // A still-covered file goes too, so the plugin-gap branch has something it
    // MUST report. Without it, "no retired path is named" is also what a check
    // that never ran the branch would print.
    const probe = ".claude/skills/board/groom.md";
    await Deno.remove(join(dir, probe));
    const byHand = await runSpecnaut(["check", "--project"], dir, home);
    const handOut = byHand.stdout + byHand.stderr;
    assertStringIncludes(handOut, probe);
    for (const rel of retiredPaths("claude")) {
      assert(!handOut.includes(rel), `check --project still names retired ${rel}:\n${handOut}`);
    }

    const up = await runSpecnaut(["upgrade"], dir, home);
    assertEquals(up.code, 0, up.stderr);
    // Upgrade restored the probe; remove it again so this check, too, must report something.
    await Deno.remove(join(dir, probe));
    const after = await runSpecnaut(["check", "--project"], dir, home);
    const afterOut = after.stdout + after.stderr;
    assertStringIncludes(afterOut, probe);
    for (const rel of retiredPaths("claude")) {
      assert(!afterOut.includes(rel), `after upgrade, check names ${rel}`);
    }
  } finally {
    await cleanup(dir, home);
  }
});

/**
 * Orphan removal is the path this feature leans on, so each containment guard a
 * bad entry meets is proven separately: one entry per run, that guard's own
 * refusal in the output, a failed upgrade, and the file outside still there.
 * With both entries in one run, the first refusal would stop the upgrade and the
 * second guard would never be reached. Both refusals come from the read side,
 * which runs first; the writer's own checks repeat them and are not reached here.
 */
for (
  const c of [
    {
      name: "a `..` entry",
      entry: (outside: string) => `../${outside.split("/").pop()}/keep.md`,
      setup: async (_dir: string, _outside: string) => {},
      refusal: "Unsafe destination (escape attempt)",
    },
    {
      name: "an entry behind a symlinked ancestor",
      entry: (_outside: string) => ".claude/escape/keep.md",
      setup: (dir: string, outside: string) => Deno.symlink(outside, join(dir, ".claude/escape")),
      refusal: "refusing to touch a path that leaves the project",
    },
  ]
) {
  Deno.test(`[claude] upgrade refuses ${c.name} and deletes nothing outside the project`, async () => {
    const { dir, home } = await sixOhProject("claude");
    const outside = await Deno.makeTempDir({ prefix: "specnaut-outside-" });
    try {
      const victim = join(outside, "keep.md");
      await Deno.writeTextFile(victim, BODY);
      await c.setup(dir, outside);
      const lockPath = join(dir, ".specnaut/installed.lock");
      await Deno.writeTextFile(
        lockPath,
        (await Deno.readTextFile(lockPath)) +
          `  ${c.entry(outside)}:\n    sha256: ${await sha256(BODY)}\n` +
          `    installed_at: "2026-01-01T00:00:00Z"\n    templates_version: 6.0.0\n`,
      );

      const up = await runSpecnaut(["upgrade"], dir, home);
      assert(up.code !== 0, `upgrade accepted ${c.name}:\n${up.stdout}${up.stderr}`);
      assertStringIncludes(up.stdout + up.stderr, c.refusal);
      assert(await exists(victim), "upgrade deleted a file outside the project");
    } finally {
      await cleanup(dir, home, outside);
    }
  });
}
