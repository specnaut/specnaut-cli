import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";
import { splitFrontmatter } from "../../src/infrastructure/harness/frontmatter.ts";

/**
 * Every shipped Markdown file's frontmatter is strict YAML.
 *
 * A value such as `argument-hint: [tag|release] [--no-push]` reads as a flow
 * sequence followed by text, which no YAML parser accepts. Nothing fails
 * loudly when that happens: Claude Code loads the skill with empty metadata,
 * and `frontmatterField` — which the Codex, Windsurf, OpenCode, Copilot and
 * Antigravity adapters read `description` through — returns null. The `board`
 * and `ship` skills shipped that way, and every harness lost their
 * descriptions without a single test noticing.
 *
 * The population is every `.md` under `templates/` and `plugin/` that opens
 * with a frontmatter block, not a list of known skills.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

async function frontmatters(): Promise<{ path: string; body: string }[]> {
  const out: { path: string; body: string }[] = [];
  for (const dir of ["templates", "plugin"]) {
    for await (const e of walk(`${ROOT}${dir}`, { exts: [".md"], includeDirs: false })) {
      // A Windows checkout converts LF to CRLF. The binary bundles templates on
      // a Linux runner, so the product never sees one; normalise here.
      const parts = splitFrontmatter((await Deno.readTextFile(e.path)).replaceAll("\r\n", "\n"));
      // Forward slashes on every platform: the filters below match on `/SKILL.md`.
      if (parts) {
        out.push({ path: relative(ROOT, e.path).replaceAll("\\", "/"), body: parts.fmBody });
      }
    }
  }
  return out;
}

Deno.test("every shipped frontmatter parses as strict YAML", async () => {
  const all = await frontmatters();
  assert(all.length > 50, `expected the whole shipped surface, found ${all.length} frontmatters`);
  const failing = all.flatMap(({ path, body }) => {
    try {
      parseYaml(body);
      return [];
    } catch (err) {
      return [`${path}: ${String(err).split("\n")[0]}`];
    }
  });
  assertEquals(failing, [], `frontmatter that does not parse:\n${failing.join("\n")}`);
});

Deno.test("every shipped skill exposes its description to the adapters", async () => {
  const skills = (await frontmatters()).filter(({ path }) => path.endsWith("/SKILL.md"));
  assert(skills.length > 10, `expected every SKILL.md, found ${skills.length}`);
  const missing = skills.flatMap(({ path, body }) => {
    try {
      const fm = parseYaml(body) as Record<string, unknown> | null;
      return typeof fm?.description === "string" && fm.description.length > 0 ? [] : [path];
    } catch {
      return [path];
    }
  });
  assertEquals(missing, [], `SKILL.md with no readable description:\n${missing.join("\n")}`);
});
