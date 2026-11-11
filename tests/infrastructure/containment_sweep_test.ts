import { assertEquals, assertGreaterOrEqual } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
  fileOf,
  mutatingModules,
  readExclusions,
  unguardedSinks,
} from "./containment_sweep_scan.ts";

/**
 * Every module that mutates the filesystem either asks the containment rule or
 * carries a written reason why it does not (cli#574).
 *
 * This exists because the rule is a property of a CLASS, and a class with no
 * membership test grows members that never learn about it. Nine modules mutated
 * the filesystem when the rule was written; the ticket named two of them and the
 * first version of the plan named four. The answer to that is not a longer list
 * — the list is what produced the miss — it is a walk of the tree.
 *
 * The failure this catches is the tenth adapter: someone adds a store, builds a
 * path under `projectDir`, writes, and nothing anywhere tells them a rule
 * exists. Without this test that lands green.
 */

const EXCLUSIONS = fromFileUrl(new URL("./containment-exclusions.txt", import.meta.url));

Deno.test("every mutating module is guarded or excused with a reason", async () => {
  const modules = await mutatingModules();

  // A FLOOR, not a bare loop. A walk that matched nothing would otherwise pass
  // this test in silence, which is the exact shape of guard this whole ticket
  // is about — one that reports clean over a surface it never read.
  assertGreaterOrEqual(
    modules.length,
    9,
    `the walk found ${modules.length} mutating modules; it found 9 when this was written, so a smaller number means the walk broke, not that the code shrank`,
  );

  const exclusions = readExclusions(await Deno.readTextFile(EXCLUSIONS));
  const excused = new Set(exclusions.map((e) => e.path));

  const unguarded: string[] = [];
  for (const rel of modules) {
    if (excused.has(rel)) continue;
    const src = await Deno.readTextFile(fromFileUrl(new URL(`../../${rel}`, import.meta.url)));
    // PER CALL SITE, not per file. The first version asked whether the module
    // mentioned `fs_containment` anywhere — so one guarded method excused every
    // other sink beside it, and that is exactly what it failed to see:
    // `FsUpgradeMarkerStore.write` guarded while `.delete` did not, and
    // `FsStagingStore.cleanupIfEmpty` reached a `Deno.remove` with nothing in
    // front of it. Both sat in files this test called covered.
    for (const fn of unguardedSinks(src)) {
      const key = `${rel}::${fn}`;
      if (!excused.has(key)) unguarded.push(key);
    }
  }

  assertEquals(
    unguarded,
    [],
    `these mutate the filesystem and neither consult the containment rule nor carry an exclusion:\n` +
      unguarded.map((u) => `  - ${u}`).join("\n") +
      `\n\nGuard them, or add a line to containment-exclusions.txt saying why the rule does not apply.`,
  );
});

Deno.test("every exclusion names a file that exists and gives a reason", async () => {
  // The allow-list's own hygiene. An entry naming a deleted file excuses
  // nothing while looking like it does, and an entry with no reason is a mute
  // button — the same two defects this repo's scaffold-drift list checks for.
  const exclusions = readExclusions(await Deno.readTextFile(EXCLUSIONS));
  assertGreaterOrEqual(exclusions.length, 1, "the file must not silently parse to nothing");

  const stale: string[] = [];
  for (const e of exclusions) {
    if (e.reason === "") stale.push(`${e.path} — no reason`);
    const abs = fromFileUrl(new URL(`../../${fileOf(e.path)}`, import.meta.url));
    if (!(await Deno.stat(abs).then(() => true).catch(() => false))) {
      stale.push(`${e.path} — file is gone`);
    }
  }
  assertEquals(stale, [], stale.join("\n"));
});

Deno.test("every exclusion is actually in the population it excuses", async () => {
  // An exclusion for a module that does NOT mutate is not protection, it is
  // noise that will outlive whatever made it look necessary — and it hides the
  // day that module starts mutating for real.
  const modules = new Set(await mutatingModules());
  const exclusions = readExclusions(await Deno.readTextFile(EXCLUSIONS));
  const orphans = exclusions.map((e) => fileOf(e.path)).filter((p) => !modules.has(p));
  assertEquals(orphans, [], `excused but not mutating any more:\n${orphans.join("\n")}`);
});
