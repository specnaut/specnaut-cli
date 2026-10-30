import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { walk } from "@std/fs";

/**
 * Every file authored under `templates/` must be registered in
 * `templates/manifest.json`, because the bundler emits only what the manifest
 * lists. An unregistered file is authored, reviewable, greppable — and absent
 * from every user's project.
 *
 * This is not hypothetical. Four instances shipped that way:
 *
 *   - `using-specnaut/SKILL.md` pointed at five `references/*-tools.md`
 *     files that were never registered, so every scaffolded project shipped a
 *     skill instructing the agent to read files that did not exist (#441).
 *   - `backlog/scripts/local/_config.sh` (#450) — the local backend's
 *     `item_url` helper existed in no project.
 *   - `backlog/scripts/cloud/columns.sh` and `reconcile.sh` (#450) — both
 *     documented in SKILL.md and invoked by the product-owner agent, neither
 *     ever scaffolded.
 *
 * The existing suite could not catch any of them: every other assertion reads
 * the authored template source, and the authored file was always there.
 * Nothing read the manifest, which is what decides what ships.
 */

const TEMPLATES = fromFileUrl(new URL("../../templates/", import.meta.url));

/**
 * Files that are deliberately authored but never scaffolded. Each entry needs
 * a reason: this list is the escape hatch, so it must not grow silently.
 */
const NOT_SHIPPED: ReadonlyArray<{ path: string; why: string }> = [
  {
    path: ".gitkeep",
    why: "git artifact keeping the directory tracked; not content",
  },
  {
    path: "core/root/README.md",
    why: "maintainer note warning that the .gitignore beside it is BOTH shipped " +
      "product content and a live per-directory ignore rule over a surface " +
      "audit.sh maps. It has to sit in this directory to be read before that " +
      "file is edited, and must never be scaffolded — shipping it would change " +
      "a consumer's tree for a maintainer's benefit.",
  },
];

async function authoredFiles(): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of walk(TEMPLATES, { includeDirs: false })) {
    // `walk` yields native separators; the manifest's `source` values are
    // always POSIX. Without this the comparison never matches on Windows and
    // every file reads as unregistered.
    const rel = entry.path.slice(TEMPLATES.length).replaceAll("\\", "/");
    if (rel === "manifest.json") continue;
    out.push(rel);
  }
  return out.sort();
}

async function registeredSources(): Promise<Set<string>> {
  const manifest = JSON.parse(
    await Deno.readTextFile(`${TEMPLATES}manifest.json`),
  ) as { core: Array<{ source?: string }>; harness_static: Array<{ source?: string }> };
  return new Set(
    [...manifest.core, ...manifest.harness_static]
      .map((e) => e.source)
      .filter((s): s is string => Boolean(s)),
  );
}

Deno.test("every authored template file is registered in the manifest", async () => {
  const registered = await registeredSources();
  const allowed = new Set(NOT_SHIPPED.map((e) => e.path));

  const unregistered = (await authoredFiles())
    .filter((f) => !registered.has(f) && !allowed.has(f));

  assertEquals(
    unregistered,
    [],
    "authored under templates/ but absent from manifest.json — these will " +
      "never be bundled and never scaffolded. Register them, or add them to " +
      "NOT_SHIPPED with a reason:\n  " + unregistered.join("\n  "),
  );
});

Deno.test("the not-shipped allowlist has no dead entries", async () => {
  // An entry that no longer matches a file is stale: it would silently permit
  // a future file at that path to go unregistered.
  const authored = new Set(await authoredFiles());
  for (const { path } of NOT_SHIPPED) {
    assert(
      authored.has(path),
      `NOT_SHIPPED lists ${path}, which no longer exists under templates/ — ` +
        `remove the entry`,
    );
  }
});

Deno.test("the not-shipped allowlist does not contradict the manifest", async () => {
  // A file cannot be both registered and declared never-shipped; that reads as
  // a deliberate exclusion while actually shipping.
  const registered = await registeredSources();
  for (const { path } of NOT_SHIPPED) {
    assert(
      !registered.has(path),
      `${path} is registered in the manifest AND listed as never shipped — ` +
        `drop the NOT_SHIPPED entry`,
    );
  }
});

Deno.test("alias-example is gone from the repo, not merely unshipped (cli#679)", async () => {
  // It documented `alias_of` / `overlays`, which nothing reads — not Specnaut,
  // not a harness. No manifest ever installed it, so no lock can carry it and
  // upgrade has nothing to retire: its absence here is the whole lock.
  const stale = (await authoredFiles()).filter((f) => f.includes("alias-example"));
  assertEquals(stale, [], "alias-example was retired by cli#679");
});
