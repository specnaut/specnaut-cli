import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";

/**
 * Spec 038, SC-004 and FR-015: the constitution lives at `docs/constitution.md`,
 * and its size thresholds in `.specnaut/memory/size-limits.md`. A shipped file
 * still naming the old address sends an agent to a file `upgrade` has moved
 * away — it reads nothing, and says nothing. A file still parsing a
 * `## Size limits` table judges sizes against a section the bootstrap no
 * longer carries.
 *
 * The population is every shipped file — `templates/`, `plugin/`, `src/`,
 * `README.md`, `AGENTS.md` — not a list of the readers found today, because the
 * next one will be written somewhere else.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

/** The legacy literal, spelled so this file does not match itself. */
const LEGACY = [".specnaut", "memory", "constitution.md"].join("/").slice(".specnaut/".length);
const SIZE_HEADING = "## Size" + " limits";

/** The migration modules: they name the old path because they move it. */
const MIGRATION = new Set([
  "src/domain/constitution_paths.ts",
  "src/domain/constitution_move.ts",
  "src/application/upgrade_constitution_move.ts",
]);

/** The one file allowed to define the size rule and its heading. */
const SIZE_HOME = "templates/core/specnaut/memory/size-limits.md";

/** The migration module that reads an old constitution's table to carry it into the config. */
const HEADING_MIGRATION = new Set(["src/domain/constitution_legacy_settings.ts"]);

/**
 * Files another phase of this spec rewrites, on a branch not yet merged here.
 * Each entry must still offend — the stale-entry test fails the moment one is
 * fixed, so the list empties itself as those branches land. Empty since the
 * ratchet reads `.specnaut/size-limits.yml` (T029).
 */
const PENDING: Readonly<Record<string, readonly ("legacy" | "heading")[]>> = {};

type Finding = { path: string; kind: "legacy" | "heading" };

async function shippedFiles(): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  for (const dir of ["templates", "plugin", "src"]) {
    for await (const e of walk(`${ROOT}${dir}`, { includeDirs: false })) {
      out.push({
        path: relative(ROOT, e.path).replaceAll("\\", "/"),
        text: await Deno.readTextFile(e.path),
      });
    }
  }
  for (const path of ["README.md", "AGENTS.md"]) {
    out.push({ path, text: await Deno.readTextFile(`${ROOT}${path}`) });
  }
  return out;
}

/** Every shipped file that names the old address, or carries the size heading outside its home. */
function findings(files: { path: string; text: string }[]): Finding[] {
  const out: Finding[] = [];
  for (const { path, text } of files) {
    if (!MIGRATION.has(path) && text.includes(LEGACY)) out.push({ path, kind: "legacy" });
    if (path !== SIZE_HOME && !HEADING_MIGRATION.has(path) && text.includes(SIZE_HEADING)) {
      out.push({ path, kind: "heading" });
    }
  }
  return out;
}

Deno.test("no shipped file names the legacy constitution path or parses a ## Size limits table", async () => {
  const unexpected = findings(await shippedFiles())
    .filter((f) => !(PENDING[f.path] ?? []).includes(f.kind))
    .map((f) => `${f.path} (${f.kind})`);
  assertEquals(unexpected, []);
});

Deno.test("every pending entry still offends — remove it once its rewrite lands", async () => {
  const found = new Set(findings(await shippedFiles()).map((f) => `${f.path} ${f.kind}`));
  const stale = Object.entries(PENDING)
    .flatMap(([path, kinds]) => kinds.map((k) => `${path} ${k}`))
    .filter((key) => !found.has(key));
  assertEquals(stale, []);
});

Deno.test("the matcher catches both shapes, and the migration allowlist only excuses the old path", () => {
  const legacy = `read \`.specnaut/${LEGACY}\` first`;
  assertEquals(findings([{ path: "templates/core/agents/x.md", text: legacy }]), [
    { path: "templates/core/agents/x.md", kind: "legacy" },
  ]);
  assertEquals(findings([{ path: "src/domain/constitution_move.ts", text: legacy }]), []);
  assertEquals(
    findings([{ path: "src/domain/constitution_move.ts", text: `${SIZE_HEADING}\n` }]),
    [{ path: "src/domain/constitution_move.ts", kind: "heading" }],
  );
  assertEquals(findings([{ path: SIZE_HOME, text: `${SIZE_HEADING}\n` }]), []);
  const extractor = [...HEADING_MIGRATION][0];
  assertEquals(findings([{ path: extractor, text: `${SIZE_HEADING}\n` }]), []);
  assertEquals(findings([{ path: extractor, text: legacy }]), [{
    path: extractor,
    kind: "legacy",
  }]);
});
