import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";
import { HARNESSES } from "../../src/cli/harnesses.ts";

/**
 * No scaffolded file ships a placeholder nothing fills in (#652).
 *
 * The phase docs inherited `{SCRIPT}` and `{ARGS}`, and the plan and tasks
 * templates `__SPECNAUT_COMMAND_PLAN__` / `__SPECNAUT_COMMAND_TASKS__`, from a
 * template engine this CLI never had. No code substitutes them, so `tasks` and
 * `implement` told the agent to "Run `{SCRIPT}`" — a command with no path — and
 * the plan template credited a token instead of a command.
 *
 * The population is the real scaffold of every harness, not the template
 * sources: a token an adapter introduced, or one a future adapter learns to
 * fill, is judged on what a project actually receives.
 */

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * The two families a render step was meant to fill: the inherited engine's
 * `{SCRIPT}` / `{ARGS}` / `{AGENT_SCRIPT}` (not `${…}`, which is shell), and
 * `__SPECNAUT_…__`. Brace tokens a reader fills by hand — `{BASE_SHA}` in a
 * request template, `{SECRET_FROM_MANAGER}` in an example — are content.
 */
const PLACEHOLDER = /(?<!\$)\{(?:SCRIPT|ARGS|AGENT_SCRIPT)\}|__SPECNAUT_[A-Z_]*__/g;

async function scaffold(harness: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: `placeholders-${harness}-` });
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
      "local",
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

export async function placeholdersIn(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const e of walk(dir, { includeDirs: false })) {
    if (!/\.(md|mdc|toml|json|ya?ml|sh|ps1|txt)$/.test(e.path)) continue;
    const text = await Deno.readTextFile(e.path);
    for (const m of text.matchAll(PLACEHOLDER)) {
      found.push(`${relative(dir, e.path).replaceAll("\\", "/")}: ${m[0]}`);
    }
  }
  return found;
}

for (const h of HARNESSES) {
  Deno.test(`${h.key}: no scaffolded file ships an unsubstituted placeholder`, async () => {
    const dir = await scaffold(h.key);
    try {
      assertEquals(await placeholdersIn(dir), []);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
}
