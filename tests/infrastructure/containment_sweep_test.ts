import { assert, assertEquals, assertGreaterOrEqual } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { walk } from "@std/fs/walk";

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

const SRC = fromFileUrl(new URL("../../src", import.meta.url));
const EXCLUSIONS = fromFileUrl(new URL("./containment-exclusions.txt", import.meta.url));

/** Deno APIs that create, move, delete or re-permission something on disk. */
const MUTATORS =
  /Deno\.(writeTextFile|writeFile|mkdir|remove|rename|chmod|create|truncate|symlink|link)\(/;

/** The generated bundle is 27k lines of template literals, not code that runs. */
const NOT_CODE = /src\/templates_bundle\.ts$/;

/** Block openers that are not functions. Without this filter an `if` inside a
 * guarded method reads as its own unguarded "function". */
const NOT_A_FUNCTION = new Set(["if", "while", "for", "switch", "catch", "do", "try"]);

/**
 * Attributes each mutating call to the method it sits in, lexically.
 *
 * No brace parsing and no AST: for every mutating call, walk BACKWARDS to the
 * nearest preceding signature and ask whether `assertInsideProject` appears
 * between the two. That is enough to answer the only question this test asks —
 * "did anybody put a guard in front of this sink" — and it fails toward a false
 * ALARM (a name in the report that turns out fine) rather than a false clean.
 */
function unguardedSinks(src: string): string[] {
  const sig =
    /(?:^|\n)[ \t]*(?:export )?(?:(?:private|protected|public|static) )*(?:async )?(?:function )?([A-Za-z_$][\w$]*)\s*\([^)]*\)[^{;=]*\{/g;
  const sigs: Array<{ at: number; name: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = sig.exec(src)) !== null) {
    if (!NOT_A_FUNCTION.has(m[1])) sigs.push({ at: m.index, name: m[1] });
  }

  const out = new Set<string>();
  const mut = new RegExp(MUTATORS.source, "g");
  while ((m = mut.exec(src)) !== null) {
    const call = m.index;
    let owner = { at: 0, name: "<module>" };
    for (const s2 of sigs) {
      if (s2.at < call) owner = s2;
      else break;
    }
    if (!src.slice(owner.at, call).includes("assertInsideProject")) out.add(owner.name);
  }
  return [...out];
}

Deno.test("unguardedSinks: a sink is charged to the method it sits in, modifiers and all", () => {
  // A `private async` method the signature pattern cannot see hands its sinks
  // to whatever function precedes it — a false alarm on the wrong name at best,
  // and a sink excused under its neighbour's exclusion at worst.
  const src = [
    "class C {",
    "  async guarded(p: string) {",
    "    await assertInsideProject(root, p);",
    "  }",
    "  private async write(p: string) {",
    "    await Deno.writeTextFile(p, 'x');",
    "  }",
    "  static remove(p: string) {",
    "    Deno.remove(p);",
    "  }",
    "}",
  ].join("\n");
  assertEquals(unguardedSinks(src).sort(), ["remove", "write"]);
});

type Exclusion = { path: string; reason: string };

/** An entry is either `<path>` or `<path>::<method>`; both name the same file. */
function fileOf(entry: string): string {
  const i = entry.indexOf("::");
  return i === -1 ? entry : entry.slice(0, i);
}

function readExclusions(text: string): Exclusion[] {
  const out: Exclusion[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const path = t.split(/\s+/)[0];
    const reason = t.slice(path.length).trim();
    out.push({ path, reason });
  }
  return out;
}

async function mutatingModules(): Promise<string[]> {
  const found: string[] = [];
  for await (const e of walk(SRC, { exts: [".ts"], includeDirs: false, followSymlinks: false })) {
    const rel = "src" + e.path.slice(SRC.length).replaceAll("\\", "/");
    if (NOT_CODE.test(rel)) continue;
    if (MUTATORS.test(await Deno.readTextFile(e.path))) found.push(rel);
  }
  return found.sort();
}

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
    //
    // The rule is crude on purpose and it is a FLOOR, not a proof: every
    // mutating call must have an `assertInsideProject` somewhere above it in
    // the same function body. It cannot tell that the guard checks the right
    // path — only `sink_containment_test.ts`'s per-site refusals do that — but
    // it does catch the sink nobody put a guard in front of at all.
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

Deno.test("readExclusions ignores comments and blank lines", () => {
  // A positive control for the parser. Every assertion above is downstream of
  // it, so a parser that returned nothing would make all three vacuously true.
  const parsed = readExclusions("# a comment\n\n  \nsrc/x.ts  because reasons\n");
  assertEquals(parsed.length, 1);
  assertEquals(parsed[0].path, "src/x.ts");
  assert(parsed[0].reason.includes("because reasons"));
});
