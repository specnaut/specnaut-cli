import type { SpecCacheStore } from "../../application/ports.ts";
import type { SpecStep } from "../../domain/spec/spec_step.ts";

/**
 * Filesystem adapter for the gitignored spec materialisation cache (spec 020,
 * D5). Writes one ordered markdown file per step under
 * `.specnaut/specs/.cache/<task>/<order>-<slug(key)>.md`, so any downstream agent
 * reads a cloud spec as ordinary files with no knowledge it lives in the cloud.
 *
 * A small `steps.json` manifest sits beside the markdown files, recording each
 * step's `key` / `name` / `order` / filename. The markdown holds the (editable)
 * body; the manifest lets `read` reconstruct full {@link SpecStep}s for
 * `spec push` after a user edits a tab — the filename alone can't recover `name`.
 *
 * The cache is disposable and never the source of truth: `write` clears the
 * task's dir first so a re-pull reconciles stale files to the current cloud
 * state (US3 AC2).
 */
export class SpecCacheWriter implements SpecCacheStore {
  private cacheDir(projectDir: string, taskNumber: number): string {
    return `${projectDir}/.specnaut/specs/.cache/${taskNumber}`;
  }

  private relDir(taskNumber: number): string {
    return `.specnaut/specs/.cache/${taskNumber}`;
  }

  private manifestPath(projectDir: string, taskNumber: number): string {
    return `${this.cacheDir(projectDir, taskNumber)}/steps.json`;
  }

  async write(
    projectDir: string,
    taskNumber: number,
    steps: readonly SpecStep[],
  ): Promise<string[]> {
    await this.clear(projectDir, taskNumber);
    const dir = this.cacheDir(projectDir, taskNumber);
    await Deno.mkdir(dir, { recursive: true });

    const written: string[] = [];
    const manifest: ManifestEntry[] = [];
    for (const step of steps) {
      const file = `${step.order}-${slug(step.key)}.md`;
      await Deno.writeTextFile(`${dir}/${file}`, step.body);
      written.push(`${this.relDir(taskNumber)}/${file}`);
      manifest.push({ key: step.key, name: step.name, order: step.order, file });
    }
    await Deno.writeTextFile(
      this.manifestPath(projectDir, taskNumber),
      JSON.stringify(manifest, null, 2),
    );
    return written;
  }

  async read(
    projectDir: string,
    taskNumber: number,
  ): Promise<readonly SpecStep[] | null> {
    const dir = this.cacheDir(projectDir, taskNumber);
    let raw: string | null;
    try {
      raw = await Deno.readTextFile(this.manifestPath(projectDir, taskNumber));
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
      // No manifest → fall back to reconstructing steps from `<order>-<slug>.md`
      // filenames, so a spec authored by writing cache files directly (cloud
      // `specify`, before any `pull`) is still pushable.
      raw = null;
    }

    const manifest = raw !== null
      ? (JSON.parse(raw) as ManifestEntry[])
      : await this.scanFilenames(dir);
    if (manifest === null) return null;

    const steps: SpecStep[] = [];
    for (const m of manifest) {
      // Re-read the body each time so a user's edit to the cached tab is what
      // gets pushed (the manifest only pins identity/order, never the content).
      const body = await Deno.readTextFile(`${dir}/${m.file}`);
      steps.push({ key: m.key, name: m.name, order: m.order, body });
    }
    steps.sort((a, b) => a.order - b.order);
    return steps;
  }

  /** Reconstruct manifest entries from `<order>-<slug>.md` filenames in a cache
   *  dir with no `steps.json`. Returns null when the dir is absent/empty. */
  private async scanFilenames(dir: string): Promise<ManifestEntry[] | null> {
    const entries: ManifestEntry[] = [];
    try {
      for await (const e of Deno.readDir(dir)) {
        if (!e.isFile || !e.name.endsWith(".md")) continue;
        const m = e.name.match(/^(\d+)-(.+)\.md$/);
        if (!m) continue;
        const order = Number(m[1]);
        const key = m[2];
        entries.push({ key, name: titleCase(key), order, file: e.name });
      }
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return null;
      throw e;
    }
    return entries.length > 0 ? entries : null;
  }

  async clear(projectDir: string, taskNumber: number): Promise<void> {
    try {
      await Deno.remove(this.cacheDir(projectDir, taskNumber), { recursive: true });
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return; // already absent — idempotent
      throw e;
    }
  }
}

type ManifestEntry = { key: string; name: string; order: number; file: string };

/** Slugify a step key for a filesystem-safe filename segment. */
function slug(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "step";
}

/** Derive a human-readable name from a slug (`user-auth` → `User Auth`) when no
 *  manifest preserved the original — a best-effort label for filename fallback. */
function titleCase(s: string): string {
  return s
    .split("-")
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
