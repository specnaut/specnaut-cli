import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * Spec 043 retired six agents, the memory seeds two of them carried, and three
 * contract skills nothing parsed (cli#678). Like spec 034's retired workflow
 * (`retired_workflow_upgrade_test.ts`), they leave through upgrade's
 * lock-driven orphan path and nothing else — no deletion by name. These tests
 * prove that holds for THIS set on both frontier harnesses, and that a project
 * file still dispatching a retired agent is named with its successor.
 *
 * The paths are what an init with the 15-agent bundle wrote, captured before
 * the files left it; nothing outside this test reads them.
 */

const AGENTS = [
  "review-coordinator",
  "test-reviewer",
  "workflow-manager",
  "qa-tester",
  "devops-sre",
  "ui-ux-designer",
] as const;
const CONTRACTS = ["handoff-protocol", "qa-report-contract", "alert-triage-contract"] as const;

const LAYOUT = {
  claude: {
    agent: (n: string) => `.claude/agents/${n}.md`,
    seeds: ["qa-tester", "devops-sre"].map((n) => `.claude/agents/${n}/memory/MEMORY.md`),
    skill: (n: string) => `.claude/skills/${n}/SKILL.md`,
    // The user's edit that upgrade must keep: on Claude, a seed the agent wrote to.
    customised: ".claude/agents/qa-tester/memory/MEMORY.md",
    own: ".claude/agents/my-reviewer.md",
  },
  codex: {
    agent: (n: string) => `.codex/agents/${n}.toml`,
    seeds: [] as string[], // Codex agents never carried a seed.
    skill: (n: string) => `.agents/skills/specnaut-${n}/SKILL.md`,
    customised: ".codex/agents/qa-tester.toml",
    own: ".codex/agents/my-reviewer.toml",
  },
} as const;
type Harness = keyof typeof LAYOUT;

const retiredPaths = (h: Harness): string[] => [
  ...AGENTS.map(LAYOUT[h].agent),
  ...LAYOUT[h].seeds,
  ...CONTRACTS.map(LAYOUT[h].skill),
];
const AGENTS_TXT = ".specnaut/hooks/_agents.txt";
const NOTICE = "names a retired agent";

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

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const lockEntry = async (rel: string, body: string) =>
  `  ${rel}:\n    sha256: ${await sha256(body)}\n    installed_at: "2026-01-01T00:00:00Z"\n` +
  `    templates_version: 7.2.0\n`;

/** Each retired file's body names its agent, so a notice reading Specnaut's own files would fire. */
const bodyOf = (rel: string) => `# ${rel}\nDispatch review-coordinator, then qa-tester.\n`;

/**
 * Init `h`, then put the project back the way the 15-agent bundle left it: the
 * retired files on disk and in the lock with the sha of what is there, the
 * retired names in `_agents.txt` and in the managed `agent-dispatch` table,
 * and no `/design` yet.
 */
async function oldBundleProject(h: Harness): Promise<{ dir: string; home: string }> {
  const dir = await Deno.makeTempDir({ prefix: `specnaut-agents-${h}-` });
  const home = await Deno.makeTempDir({ prefix: "specnaut-home-" });
  const init = await runSpecnaut(
    ["init", "--here", "--no-git", "--ai", h, "--backlog", "local"],
    dir,
    home,
  );
  assertEquals(init.code, 0, `init failed: ${init.out}`);
  const lockPath = join(dir, ".specnaut/installed.lock");
  const design = LAYOUT[h].skill("design");
  await Deno.remove(join(dir, design));
  const drop = (lock: string, rel: string) =>
    lock.replace(new RegExp(`  ${rel.replace(/[.]/g, "\\.")}:\\n(    .*\\n)+`), "");
  let lock = drop(drop(await Deno.readTextFile(lockPath), design), AGENTS_TXT);

  const agentsTxt = (await Deno.readTextFile(join(dir, AGENTS_TXT))) + AGENTS.join("\n") + "\n";
  await Deno.writeTextFile(join(dir, AGENTS_TXT), agentsTxt);
  lock += await lockEntry(AGENTS_TXT, agentsTxt);
  for (const rel of retiredPaths(h)) {
    await Deno.mkdir(join(dir, rel, ".."), { recursive: true });
    await Deno.writeTextFile(join(dir, rel), bodyOf(rel));
    lock += await lockEntry(rel, bodyOf(rel));
  }
  await Deno.writeTextFile(lockPath, lock);

  const agentsMd = join(dir, "AGENTS.md");
  const end = "<!-- --- End Specnaut: agent-dispatch --- -->";
  const md = await Deno.readTextFile(agentsMd);
  assertStringIncludes(md, end);
  await Deno.writeTextFile(
    agentsMd,
    md.replace(end, "| `review` — the structural review | `review-coordinator` |\n\n" + end),
  );
  return { dir, home };
}

const dispatchSection = (md: string) =>
  md.slice(md.indexOf("Specnaut: agent-dispatch ---"), md.indexOf("End Specnaut: agent-dispatch"));
const namesAny = (text: string) => AGENTS.filter((n) => new RegExp(`\\b${n}\\b`).test(text));

async function cleanup(...dirs: string[]) {
  for (const d of dirs) await Deno.remove(d, { recursive: true });
}

for (const h of ["claude", "codex"] as const) {
  Deno.test(`[${h}] a fresh init writes none of the retired agents or contracts`, async () => {
    const dir = await Deno.makeTempDir({ prefix: `specnaut-fresh-${h}-` });
    const home = await Deno.makeTempDir({ prefix: "specnaut-home-" });
    try {
      const init = await runSpecnaut(
        ["init", "--here", "--no-git", "--ai", h, "--backlog", "local"],
        dir,
        home,
      );
      assertEquals(init.code, 0, init.out);
      for (const rel of retiredPaths(h)) {
        assertEquals(await exists(join(dir, rel)), false, `fresh init wrote retired ${rel}`);
      }
      assert(await exists(join(dir, LAYOUT[h].agent("code-reviewer"))), "code-reviewer missing");
    } finally {
      await cleanup(dir, home);
    }
  });

  Deno.test(`[${h}] upgrade prunes the vanilla retired files, keeps a customised one until --force`, async () => {
    const { dir, home } = await oldBundleProject(h);
    try {
      const kept = LAYOUT[h].customised;
      await Deno.writeTextFile(join(dir, kept), bodyOf(kept) + "- my own note\n");

      // The plant took: the retired names are there for upgrade to remove.
      assertEquals(namesAny(await Deno.readTextFile(join(dir, AGENTS_TXT))), [...AGENTS]);
      assertEquals(namesAny(dispatchSection(await Deno.readTextFile(join(dir, "AGENTS.md")))), [
        "review-coordinator",
      ]);

      const up = await runSpecnaut(["upgrade"], dir, home);
      assertEquals(up.code, 0, up.out);
      for (const rel of retiredPaths(h).filter((p) => p !== kept)) {
        assertEquals(await exists(join(dir, rel)), false, `${rel} survived the upgrade`);
      }
      assert(await exists(join(dir, kept)), "a customised copy is the user's: kept");
      assertStringIncludes(up.out, `⚠ ${kept}`);
      assertStringIncludes(up.out, "1 orphan-preserved");
      // Specnaut's own files name retired agents; only the user's are read.
      assert(!up.out.includes(NOTICE), `the notice fired on Specnaut's files:\n${up.out}`);

      assertEquals(namesAny(await Deno.readTextFile(join(dir, AGENTS_TXT))), []);
      const section = dispatchSection(await Deno.readTextFile(join(dir, "AGENTS.md")));
      assertStringIncludes(section, "code-reviewer");
      assertEquals(
        namesAny(section),
        [],
        `agent-dispatch still names a retired agent:\n${section}`,
      );
      assert(await exists(join(dir, LAYOUT[h].skill("design"))), "/design was not installed");

      const check = await runSpecnaut(["check", "--project"], dir, home);
      const project = check.out.slice(check.out.indexOf("project ("));
      assertStringIncludes(project, "templates version");
      assert(!/[⚠✗]/.test(project), `check --project is not clean:\n${project}`);

      const forced = await runSpecnaut(["upgrade", "--force"], dir, home);
      assertEquals(forced.code, 0, forced.out);
      assertEquals(await exists(join(dir, kept)), false, "--force left the customised copy");
      assertStringIncludes(
        await Deno.readTextFile(join(dir, `${kept}.specnaut.bak`)),
        "my own note",
      );
      assertStringIncludes(forced.out, `backed up ${kept}`);
    } finally {
      await cleanup(dir, home);
    }
  });

  Deno.test(`[${h}] upgrade names a retired agent the user's addendum or own agent dispatches`, async () => {
    const { dir, home } = await oldBundleProject(h);
    try {
      const addendum = ".specnaut/addenda/task/review.md";
      await Deno.mkdir(join(dir, ".specnaut/addenda/task"), { recursive: true });
      await Deno.writeTextFile(join(dir, addendum), "Dispatch `review-coordinator` last.\n");
      await Deno.writeTextFile(join(dir, LAYOUT[h].own), "# mine\nHand tests to test-reviewer.\n");

      const up = await runSpecnaut(["upgrade"], dir, home);
      assertEquals(up.code, 0, up.out);
      assertStringIncludes(
        up.out,
        `${addendum} ${NOTICE} — review-coordinator → the main session runs phases/review.md`,
      );
      assertStringIncludes(up.out, `${LAYOUT[h].own} ${NOTICE} — test-reviewer → code-reviewer`);
      assertStringIncludes(up.out, "memory seeds are kept until `specnaut upgrade --force`");
      // Read-only: the user's files are untouched.
      assertStringIncludes(await Deno.readTextFile(join(dir, addendum)), "review-coordinator");
      assert(await exists(join(dir, LAYOUT[h].own)), "the user's own agent was removed");
    } finally {
      await cleanup(dir, home);
    }
  });
}
