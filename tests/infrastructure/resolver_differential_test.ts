import { assertEquals } from "@std/assert";
import { join, SEPARATOR } from "@std/path";
import { resolveTarget } from "../../src/infrastructure/fs_containment.ts";
import { symlinkTest } from "../helpers/link_text.ts";

/**
 * The kernel is the oracle.
 *
 * Two review rounds each found a CRITICAL in `resolveTarget`, both real, both
 * the same shape: a layout where our resolution disagreed with what the
 * operating system actually does. Round 1 was `..` collapsed against an
 * unresolved parent. Round 2 was following one hop where the kernel follows a
 * chain. Adding a case per round does not terminate — the space of symlink
 * layouts is not enumerable by imagination, and every fixed depth is the same
 * bug waiting for one more link.
 *
 * So this test stops guessing and asks the OS. For each layout it computes the
 * ONE thing the guard actually needs to know — *where would a write to this
 * path land* — by writing a marker and asking `realPath` where it went. Then it
 * requires `resolveTarget` to have said the same thing.
 *
 * A disagreement here is a containment hole by definition, whatever shape it
 * takes, including shapes nobody has thought of yet.
 */

type Layout = { name: string; build: (proj: string, outside: string) => Promise<void> };

/** The link targets every layout is generated with, by name. */
const targets = (proj: string, outside: string) => ({
  "abs-inside-file": join(proj, "real.md"),
  "abs-outside-file": join(outside, "real.md"),
  "abs-inside-absent": join(proj, "absent.md"),
  "abs-outside-absent": join(outside, "absent.md"),
  "rel-sibling": "real.md",
  "rel-up-inside": join("..", "real.md"),
  "rel-up-outside": join("..", "..", "outside", "real.md"),
  "rel-dotdot-chain": join("..", "..", "outside", "sub", "real.md"),
  // `..` AFTER a link, in the link's own text (cli#686). Built with a raw
  // separator, never `join`: `join` collapses `s/..` to nothing, which is the
  // very misreading under test. The kernel follows `s` first, then applies
  // `..` to where it landed.
  "rel-through-link-up": ["s", "..", "real.md"].join(SEPARATOR),
  "rel-through-link-up-absent": ["s", "..", "evil.md"].join(SEPARATOR),
  "rel-through-link-twice": ["s", "..", "sub", "..", "evil.md"].join(SEPARATOR),
  "abs-through-link-up": [proj, "ps", "..", "evil.md"].join(SEPARATOR),
});

type Ancestor = "real" | "link-inside" | "link-outside";
type TargetKey = keyof ReturnType<typeof targets>;

/** Builds one layout: the fixture tree, the `d` ancestor, and a `chain`-link leaf to `key`. */
async function buildLayout(
  proj: string,
  outside: string,
  ancestor: Ancestor,
  chain: number,
  key: TargetKey,
): Promise<void> {
  await Deno.writeTextFile(join(proj, "real.md"), "inside");
  await Deno.mkdir(join(outside, "sub"), { recursive: true });
  await Deno.writeTextFile(join(outside, "real.md"), "outside");
  await Deno.writeTextFile(join(outside, "sub", "real.md"), "outside-sub");
  await Deno.mkdir(join(proj, "realdir"));
  await Deno.writeTextFile(join(proj, "realdir", "real.md"), "inside-dir");
  await Deno.mkdir(join(outside, "linked"));
  await Deno.writeTextFile(join(outside, "linked", "real.md"), "outside-dir");

  const dir = join(proj, "d");
  if (ancestor === "real") await Deno.mkdir(dir);
  else if (ancestor === "link-inside") await Deno.symlink(join(proj, "realdir"), dir);
  else await Deno.symlink(join(outside, "linked"), dir);

  // The links the through-link targets pass through: `s` beside the
  // leaf and `ps` at the project root, both into the outside tree.
  await Deno.symlink(join(outside, "sub"), join(dir, "s"));
  await Deno.symlink(join(outside, "sub"), join(proj, "ps"));

  const t = targets(proj, outside)[key];
  if (chain === 0) {
    // The leaf is a real file, no link at all — the control case.
    await Deno.writeTextFile(join(dir, "leaf.md"), "leaf");
    return;
  }
  // A chain of `chain` links ending at `t`.
  let prev = t;
  for (let i = chain - 1; i >= 1; i--) {
    await Deno.symlink(prev, join(dir, `hop${i}.md`));
    prev = `hop${i}.md`;
  }
  await Deno.symlink(prev, join(dir, "leaf.md"));
}

/** Every combination worth generating, enumerated rather than randomised, so a
 * failure names a layout that can be rebuilt by hand. */
function layouts(): Layout[] {
  const out: Layout[] = [];
  for (const ancestor of ["real", "link-inside", "link-outside"] as const) {
    for (const chain of [0, 1, 2, 3]) {
      for (const key of Object.keys(targets("", "")) as TargetKey[]) {
        out.push({
          name: `ancestor=${ancestor} chain=${chain} target=${key}`,
          build: (proj, outside) => buildLayout(proj, outside, ancestor, chain, key),
        });
      }
    }
  }
  return out;
}

/**
 * Where a write to `p` ACTUALLY lands, according to the kernel.
 *
 * Writes a marker, then asks `realPath` where the file that now exists is. That
 * is the only definition of the invariant the guard protects, and it is not
 * open to interpretation.
 */
async function whereAWriteLands(p: string): Promise<string | "unwritable"> {
  try {
    await Deno.writeTextFile(p, "marker");
  } catch {
    return "unwritable";
  }
  try {
    return await Deno.realPath(p);
  } catch {
    return "unwritable";
  }
}

symlinkTest("resolveTarget agrees with the kernel on every generated layout", async () => {
  const all = layouts();
  const disagreements: string[] = [];

  for (const layout of all) {
    const root = await Deno.makeTempDir({ prefix: "diff-" });
    const proj = join(root, "proj");
    const outside = join(root, "outside");
    await Deno.mkdir(proj);
    await Deno.mkdir(outside);
    try {
      await layout.build(proj, outside);
      const p = join(proj, "d", "leaf.md");

      let ours: string | "threw";
      try {
        ours = await resolveTarget(p);
      } catch {
        ours = "threw";
      }

      const truth = await whereAWriteLands(p);

      // A path the kernel refuses to write is one our guard may answer either
      // way — it cannot be an escape. Everything else must match exactly.
      if (truth === "unwritable") continue;
      if (ours === "threw" || ours !== truth) {
        disagreements.push(`${layout.name}\n    ours:  ${ours}\n    truth: ${truth}`);
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }

  assertEquals(
    disagreements,
    [],
    `${disagreements.length} of ${all.length} layouts resolve somewhere other than where a write lands:\n\n` +
      disagreements.join("\n\n"),
  );
});
