// The one definition of "a marketplace catalog is pinned to this release".
//
// Each catalog entry pins its plugin to a git ref — the release tag. Three
// places used to decide whether that held, two by regex and one by jq: the
// bump matched `"ref": "v…"` and so never stamped an entry with no ref or with
// `"ref": "main"`, the local gate could not see such an entry either, and only
// release.yml caught it, after the tag was pushed, which costs a version
// number. All three now call this.
//
// Usage:
//   deno run --allow-read scripts/catalog-refs.ts --check v<X.Y.Z>
// Exit 0 = every entry of every catalog is pinned to the tag; 1 = not (each
// problem printed); 2 = usage.

export const CATALOG_FILES = [
  "packaging/marketplace/.claude-plugin/marketplace.json",
  "packaging/marketplace/.github/plugin/marketplace.json",
] as const;

/**
 * The scaffolded Claude Code settings declare Specnaut's marketplace, read from
 * this repository at the release tag — so a project gets the cockpit of the
 * binary that scaffolded it, not whatever a branch holds at install time.
 */
export const SETTINGS_TEMPLATE = "templates/harness-specific/claude/settings.json";
const MARKETPLACE = "specnaut-marketplace";

type Settings = { extraKnownMarketplaces?: Record<string, { source?: { ref?: unknown } }> };

export function stampDeclarationRef(text: string, tag: string): string {
  const settings = JSON.parse(text) as Settings;
  const source = settings.extraKnownMarketplaces?.[MARKETPLACE]?.source;
  if (source && typeof source === "object") source.ref = tag;
  return `${JSON.stringify(settings, null, 2)}\n`;
}

export function declarationRefProblems(text: string, tag: string): string[] {
  let settings: Settings;
  try {
    settings = JSON.parse(text) as Settings;
  } catch (err) {
    return [`not valid JSON: ${(err as Error).message}`];
  }
  const source = settings.extraKnownMarketplaces?.[MARKETPLACE]?.source;
  if (!source) return [`declares no ${MARKETPLACE} marketplace`];
  if (source.ref === undefined) {
    return [`${MARKETPLACE} has no ref — it would read the default branch`];
  }
  return source.ref === tag
    ? []
    : [`${MARKETPLACE} is pinned to ${JSON.stringify(source.ref)}, not ${tag}`];
}

type Entry = { name?: unknown; source?: unknown };
type Catalog = { plugins?: unknown };

function entries(catalog: Catalog): Entry[] {
  return Array.isArray(catalog.plugins) ? catalog.plugins as Entry[] : [];
}

/** The catalog with every entry's `source.ref` set to `tag`, two-space JSON. */
export function stampCatalogRefs(text: string, tag: string): string {
  const catalog = JSON.parse(text) as Catalog;
  for (const e of entries(catalog)) {
    if (e.source && typeof e.source === "object") (e.source as { ref?: string }).ref = tag;
  }
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

/** Every way the catalog fails to pin all of its entries to `tag`; [] when it does. */
export function catalogRefProblems(text: string, tag: string): string[] {
  let catalog: Catalog;
  try {
    catalog = JSON.parse(text) as Catalog;
  } catch (err) {
    return [`not valid JSON: ${(err as Error).message}`];
  }
  const list = entries(catalog);
  if (list.length === 0) return ["lists no plugins"];
  return list.flatMap((e, i) => {
    const name = typeof e.name === "string" ? e.name : `plugins[${i}]`;
    const source = e.source;
    if (!source || typeof source !== "object") {
      return [`${name} has no source object, so nothing pins it`];
    }
    const ref = (source as { ref?: unknown }).ref;
    if (ref === undefined) return [`${name} has no ref — it would install the default branch`];
    return ref === tag ? [] : [`${name} is pinned to ${JSON.stringify(ref)}, not ${tag}`];
  });
}

async function main() {
  const [flag, tag] = Deno.args;
  if (flag !== "--check" || !tag || !/^v\d+\.\d+\.\d+/.test(tag)) {
    console.error("usage: catalog-refs.ts --check v<X.Y.Z>");
    Deno.exit(2);
  }
  let failed = false;
  for (const file of CATALOG_FILES) {
    for (const p of catalogRefProblems(await Deno.readTextFile(file), tag)) {
      console.error(`${file}: ${p}`);
      failed = true;
    }
  }
  for (const p of declarationRefProblems(await Deno.readTextFile(SETTINGS_TEMPLATE), tag)) {
    console.error(`${SETTINGS_TEMPLATE}: ${p}`);
    failed = true;
  }
  if (failed) Deno.exit(1);
  console.log(
    `catalog-refs: ✓ ${CATALOG_FILES.length} catalogs and the scaffolded marketplace are pinned to ${tag}`,
  );
}

if (import.meta.main) await main();
