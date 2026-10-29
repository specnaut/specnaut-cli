/**
 * How many bytes of skill frontmatter every session loads, per harness.
 *
 * A harness lists every installed skill to the model by its name and
 * description, whether or not the skill is ever used (cli#674 AC 7, cli#683).
 * Claude Code also lists `when_to_use`; Codex lists the description alone. A
 * skill marked `disable-model-invocation: true` is not listed, so it costs
 * nothing.
 *
 *   deno run --allow-read --allow-run scripts/skill-description-bytes.ts [--ref <git-ref>]
 *
 * With `--ref`, the templates are read from that commit (`git show`), so a
 * branch can be compared with `main` without checking it out.
 */
import { parse } from "@std/yaml";

const SKILL_CATEGORIES = new Set(["skill", "backlog-skill"]);

interface ManifestEntry {
  readonly category: string;
  readonly name: string;
  readonly source: string;
}

async function readAt(ref: string | null, path: string): Promise<string> {
  if (ref === null) return await Deno.readTextFile(path);
  const out = await new Deno.Command("git", { args: ["show", `${ref}:${path}`] }).output();
  if (!out.success) throw new Error(`git show ${ref}:${path} failed`);
  return new TextDecoder().decode(out.stdout);
}

function frontmatter(md: string): Record<string, unknown> {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  return m ? (parse(m[1]) as Record<string, unknown>) ?? {} : {};
}

const bytes = (v: unknown) => typeof v === "string" ? new TextEncoder().encode(v).length : 0;

async function main() {
  const i = Deno.args.indexOf("--ref");
  const ref = i >= 0 ? Deno.args[i + 1] ?? null : null;
  if (i >= 0 && ref === null) throw new Error("--ref needs a value");

  const manifest = JSON.parse(await readAt(ref, "templates/manifest.json")) as {
    core: ManifestEntry[];
  };
  const rows: Array<{ name: string; claude: number; codex: number }> = [];
  for (const e of manifest.core) {
    if (!SKILL_CATEGORIES.has(e.category)) continue;
    const fm = frontmatter(await readAt(ref, `templates/${e.source}`));
    if (fm["disable-model-invocation"] === true) continue;
    const base = bytes(e.name) + bytes(fm.description);
    rows.push({ name: e.name, claude: base + bytes(fm.when_to_use), codex: base });
  }
  rows.sort((a, b) => b.claude - a.claude);
  for (const r of rows) {
    console.log(`${String(r.claude).padStart(6)} ${String(r.codex).padStart(6)}  ${r.name}`);
  }
  const sum = (k: "claude" | "codex") => rows.reduce((n, r) => n + r[k], 0);
  console.log(
    `${String(sum("claude")).padStart(6)} ${
      String(sum("codex")).padStart(6)
    }  TOTAL (${rows.length} skills; columns: Claude Code, Codex)`,
  );
}

await main();
