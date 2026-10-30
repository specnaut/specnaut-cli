import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";
import { HARNESSES } from "../../src/cli/harnesses.ts";

/**
 * No scaffold sends its agents to a path its harness never receives (#656).
 *
 * The integration tests asserted that a Codex scaffold has no `.claude/`
 * DIRECTORY, and nothing read the text: every non-Claude scaffold shipped 33
 * files naming `.claude/...` paths. The product-owner was told, every session,
 * to read a memory file only Claude Code receives; the board skill sent the
 * reader to `.claude/agents/product-owner.md`, which on Codex is a TOML file
 * somewhere else.
 *
 * The population is the real scaffold of every harness, so a reference an
 * adapter introduces is judged on what a project actually receives.
 */

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/** Every harness-owned root, keyed by the harness that owns it. */
const ROOTS: Record<string, RegExp> = {
  claude: /(?<![\w~])\.claude\//g,
  codex: /(?<![\w~])\.codex\//g,
  cursor: /(?<![\w~])\.cursor\//g,
  opencode: /(?<![\w~])\.opencode\//g,
};

/**
 * A reference that is RIGHT on every harness, each with its reason. Keyed on
 * the shipped file's basename stem and the root it names. `section` narrows the
 * allowance to the `## ` heading it is true under; absent ⇒ the whole file.
 */
const ALLOWED: Record<string, { reason: string; section?: string }> = {
  // The guard ships to both harnesses from one source and protects each one's
  // hook registration; on the other harness the path simply never exists.
  "protect-generated.sh .codex/": {
    reason: "names the Codex registration it gates; absent on Claude, never written to",
  },
  "protect-generated.sh .claude/": {
    reason: "names the Claude registration it gates; absent on Codex, never written to",
  },
  // cli#679: one reference for both design-target harnesses, read on request. Its `.claude/`
  // paths are facts about Claude Code only while they sit under its heading.
  "integrations .claude/": {
    reason: "the Claude Code section of the two-harness integrations reference",
    section: "Claude Code",
  },
  "facts-integrations .claude/": {
    reason: "the same reference, under Copilot's flattened instruction name",
    section: "Claude Code",
  },
};

/** Entries an allowance actually excused, so a stale one is caught. */
const used = new Set<string>();

/** The `## ` heading in force at `offset`, or "" above the first one. */
function sectionAt(text: string, offset: number): string {
  const headings = [...text.slice(0, offset).matchAll(/^## (.+)$/gm)];
  return headings.at(-1)?.[1].trim() ?? "";
}

function allowed(file: string, root: string, text: string, offset: number): boolean {
  const stem = file.split("/").filter((s) => s !== "SKILL.md").pop()!
    .replace(/\.(instructions\.)?md$/, "").replace(/^specnaut-/, "");
  const key = `${stem} ${root}`;
  const rule = ALLOWED[key];
  if (rule === undefined) return false;
  if (rule.section !== undefined && sectionAt(text, offset) !== rule.section) return false;
  used.add(key);
  return true;
}

/**
 * Every backlog backend: the board skill is filtered per backend, and the
 * `.claude/loop.md` reference lived in a section only one backend receives.
 */
const BACKENDS: ReadonlyArray<readonly string[]> = [
  ["local"],
  ["github", "--backlog-url", "https://github.com/orgs/example/projects/1"],
  ["gitlab", "--backlog-url", "https://gitlab.com/example/project"],
  ["cloud"],
];

async function scaffold(harness: string, backend: readonly string[]): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: `paths-${harness}-${backend[0]}-` });
  const { code, stderr } = await new Deno.Command("deno", {
    args: [
      "run",
      "--allow-all",
      MAIN,
      "init",
      "--here",
      "--no-git",
      "--ai",
      harness,
      "--backlog",
      ...backend,
      "--spec-backend",
      "local",
    ],
    cwd: dir,
    stdin: "null",
    stdout: "null",
    stderr: "piped",
  }).output();
  assertEquals(code, 0, new TextDecoder().decode(stderr));
  return dir;
}

/** `<file>: <root>` for every reference to a root this harness does not own. */
async function foreignRoots(dir: string, own: string): Promise<string[]> {
  const found: string[] = [];
  for await (const e of walk(dir, { includeDirs: false })) {
    if (!/\.(md|mdc|toml|json|ya?ml|sh|ps1|txt)$/.test(e.path)) continue;
    const text = await Deno.readTextFile(e.path);
    for (const [owner, re] of Object.entries(ROOTS)) {
      if (owner === own) continue;
      for (const m of text.matchAll(re)) {
        if (allowed(relative(dir, e.path).replaceAll("\\", "/"), m[0], text, m.index)) continue;
        found.push(`${relative(dir, e.path).replaceAll("\\", "/")}: ${m[0]}`);
      }
    }
  }
  return [...new Set(found)].sort();
}

for (const h of HARNESSES) {
  Deno.test(`${h.key}: no scaffolded file names another harness's root`, async () => {
    for (const backend of BACKENDS) {
      const dir = await scaffold(h.key, backend);
      try {
        assertEquals(await foreignRoots(dir, h.key), [], `backend ${backend[0]}`);
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    }
  });
}

// Registered last, so it runs after every harness above has been scanned.
Deno.test("every allowance still excuses something", () => {
  assertEquals(Object.keys(ALLOWED).filter((k) => !used.has(k)), []);
});
