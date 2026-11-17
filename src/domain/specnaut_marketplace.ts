/**
 * The one definition of "this marketplace declaration is Specnaut's own" — the
 * source `.claude/settings.json` names for the cockpit's catalog (cli#783).
 *
 * Claude Code reads the catalog from this repository at the release tag. It is
 * declared as a `url` source on raw.githubusercontent.com, because a `github`
 * source carrying `path` is not refreshed by Claude Code: the refresh looks for
 * `.claude-plugin/marketplace.json` at the repository root and reports the
 * catalog gone, so the cockpit never loads. Releases up to 9.4.0 wrote that
 * `github` form; it is recognised here as `legacy` so an upgrade replaces it.
 *
 * The upgrade merge, its notes and the release stamp and check all ask this
 * module, so the shape is decided once. Matching is exact — a parsed URL, one
 * host, one owner, repository and path, one ref segment, no other key — because
 * anything a looser rule matched would be a user's own choice overwritten.
 *
 * Pure — no IO, no Deno globals.
 */

const OWNER = "specnaut";
const REPOSITORY = "specnaut-cli";
const HOST = "raw.githubusercontent.com";
/** Where the Claude Code catalog sits in this repository, at every tag. */
export const CLAUDE_CATALOG_PATH = "packaging/marketplace/.claude-plugin/marketplace.json";
const PATH_SEGMENTS = CLAUDE_CATALOG_PATH.split("/");
const REF = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;

/** A marketplace source as `.claude/settings.json` holds it, unchecked. */
export type MarketplaceSource = Record<string, unknown>;

/**
 * What a project's declaration is, for the key Specnaut declares:
 *   - `absent`  — the key is not there;
 *   - `current` — Specnaut's url source, at any tag;
 *   - `legacy`  — the `github` + `path` source releases up to 9.4.0 wrote, at any ref;
 *   - `foreign` — anything else, the user's own: a fork, a mirror, a key with
 *                 no source, an extra field.
 */
export type Declaration = "absent" | "current" | "legacy" | "foreign";

/** Specnaut's url source for `tag`. */
export function specnautMarketplaceSource(tag: string): MarketplaceSource {
  if (!REF.test(tag)) throw new Error(`not a release ref: ${JSON.stringify(tag)}`);
  return {
    source: "url",
    url: `https://${HOST}/${OWNER}/${REPOSITORY}/${tag}/${CLAUDE_CATALOG_PATH}`,
  };
}

/** The tag Specnaut's url source is pinned to, or `null` when `source` is not that source. */
export function specnautMarketplaceRef(source: unknown): string | null {
  if (!isRecord(source) || !hasExactKeys(source, ["source", "url"])) return null;
  if (source.source !== "url" || typeof source.url !== "string") return null;
  if (!URL.canParse(source.url)) return null;
  const url = new URL(source.url);
  if (url.protocol !== "https:" || url.hostname !== HOST || url.port !== "") return null;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    return null;
  }
  const [owner, repository, ref, ...path] = url.pathname.split("/").slice(1);
  if (owner !== OWNER || repository !== REPOSITORY || ref === undefined || !REF.test(ref)) {
    return null;
  }
  const samePath = path.length === PATH_SEGMENTS.length &&
    path.every((segment, i) => segment === PATH_SEGMENTS[i]);
  return samePath ? ref : null;
}

/** What the declaration under Specnaut's key is — see {@link Declaration}. */
export function classifyDeclaration(entry: unknown): Declaration {
  if (entry === undefined) return "absent";
  const source = isRecord(entry) ? entry.source : undefined;
  if (specnautMarketplaceRef(source) !== null) return "current";
  return isLegacySource(source) ? "legacy" : "foreign";
}

/** How a note names a source: Specnaut's as `owner/repo@tag`, any other by its repo or URL. */
export function describeSource(source: unknown): string {
  const ref = specnautMarketplaceRef(source);
  if (ref !== null) return `${OWNER}/${REPOSITORY}@${ref}`;
  if (!isRecord(source)) return "a custom source";
  const where = source.repo ?? source.url;
  return typeof where === "string" ? where : "a custom source";
}

function isLegacySource(source: unknown): boolean {
  if (!isRecord(source)) return false;
  const allowed = new Set(["source", "repo", "path", "ref"]);
  if (!Object.keys(source).every((k) => allowed.has(k))) return false;
  return source.source === "github" && source.repo === `${OWNER}/${REPOSITORY}` &&
    source.path === CLAUDE_CATALOG_PATH &&
    (source.ref === undefined || typeof source.ref === "string");
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((k) => own.includes(k));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
