import { assert, assertEquals } from "@std/assert";
import { dirname, join, SEPARATOR } from "@std/path";
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

/**
 * Where a chain's intermediate hops live, and the text each link uses to reach
 * the next one (cli#690). Only the final hop carries the target's text.
 *
 *  - `sibling` — beside the leaf, a bare name (`hopN.md`);
 *  - `dotted` — beside the leaf, through a real folder and back
 *    (`x/../hopN.md`): a hop whose own text has directory and `..` segments;
 *  - `other-dir` — in a `hops/` beside the leaf's REAL folder, reached as
 *    `../hops/hopN.md`: a hop into another directory before the final target,
 *    through `..` applied where the link really sits — `proj/hops/` unless `d`
 *    is linked outside, then `outside/hops/`.
 */
type HopStyle = "sibling" | "dotted" | "other-dir";

/** Raw separators, never `join`: `join` collapses `x/..`, the very misreading under test. */
type Hops = { dir: (d: string) => Promise<string>; text: (i: number) => string };
const HOP: Record<HopStyle, Hops> = {
  sibling: { dir: (d) => Promise.resolve(d), text: (i) => `hop${i}.md` },
  dotted: {
    dir: (d) => Promise.resolve(d),
    text: (i) => ["x", "..", `hop${i}.md`].join(SEPARATOR),
  },
  "other-dir": {
    dir: async (d) => join(dirname(await Deno.realPath(d)), "hops"),
    text: (i) => ["..", "hops", `hop${i}.md`].join(SEPARATOR),
  },
};

/** The fixture tree every layout shares: real files and folders, inside and out. */
async function buildFixture(proj: string, outside: string): Promise<void> {
  await Deno.writeTextFile(join(proj, "real.md"), "inside");
  await Deno.mkdir(join(outside, "sub"), { recursive: true });
  await Deno.writeTextFile(join(outside, "real.md"), "outside");
  await Deno.writeTextFile(join(outside, "sub", "real.md"), "outside-sub");
  await Deno.mkdir(join(proj, "realdir"));
  await Deno.writeTextFile(join(proj, "realdir", "real.md"), "inside-dir");
  await Deno.mkdir(join(outside, "linked"));
  await Deno.writeTextFile(join(outside, "linked", "real.md"), "outside-dir");
  // `hops/` on both sides: from a `d` linked outside, `../hops/` lands in `outside/hops/`.
  await Deno.mkdir(join(proj, "hops"));
  await Deno.mkdir(join(outside, "hops"));
}

/** `proj/d`, the leaf's folder, as `ancestor` says, with the links the through-link targets need. */
async function buildAncestor(proj: string, outside: string, ancestor: Ancestor): Promise<string> {
  const dir = join(proj, "d");
  if (ancestor === "real") await Deno.mkdir(dir);
  else if (ancestor === "link-inside") await Deno.symlink(join(proj, "realdir"), dir);
  else await Deno.symlink(join(outside, "linked"), dir);
  // `s` beside the leaf and `ps` at the project root, both into the outside
  // tree; `x` a real folder for the `dotted` hops to pass through.
  await Deno.symlink(join(outside, "sub"), join(dir, "s"));
  await Deno.symlink(join(outside, "sub"), join(proj, "ps"));
  await Deno.mkdir(join(dir, "x"));
  return dir;
}

/** Builds one layout: the fixture, the `d` ancestor, and a `chain`-link leaf to `t`. */
async function buildLayout(
  proj: string,
  outside: string,
  shape: { ancestor: Ancestor; chain: number; style: HopStyle; t: string },
): Promise<void> {
  await buildFixture(proj, outside);
  const dir = await buildAncestor(proj, outside, shape.ancestor);
  // chain 0: the leaf is a real file, no link at all — the control case.
  if (shape.chain === 0) return await Deno.writeTextFile(join(dir, "leaf.md"), "leaf");
  // A chain of `chain` links ending at `t`: hop1 … hop(chain-1), then the leaf.
  const hops = HOP[shape.style];
  let prev = shape.t;
  for (let i = shape.chain - 1; i >= 1; i--) {
    await Deno.symlink(prev, join(await hops.dir(dir), `hop${i}.md`));
    prev = hops.text(i);
  }
  await Deno.symlink(prev, join(dir, "leaf.md"));
}

/** Every combination worth generating, enumerated rather than randomised, so a
 * failure names a layout that can be rebuilt by hand. A hop style only varies a
 * chain that has intermediate hops (2 links or more). */
function layouts(): Layout[] {
  const out: Layout[] = [];
  for (const ancestor of ["real", "link-inside", "link-outside"] as const) {
    for (const chain of [0, 1, 2, 3]) {
      const styles: HopStyle[] = chain < 2 ? ["sibling"] : ["sibling", "dotted", "other-dir"];
      for (const style of styles) {
        for (const key of Object.keys(targets("", "")) as TargetKey[]) {
          out.push({
            name: `ancestor=${ancestor} chain=${chain} hops=${style} target=${key}`,
            build: (proj, outside) =>
              buildLayout(proj, outside, {
                ancestor,
                chain,
                style,
                t: targets(proj, outside)[key],
              }),
          });
        }
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
 * open to interpretation. A write the kernel refuses comes back as the error's
 * name, so the run can say how many layouts never tested anything, and why.
 */
async function whereAWriteLands(p: string): Promise<string | { unwritable: string }> {
  try {
    await Deno.writeTextFile(p, "marker");
    return await Deno.realPath(p);
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    return { unwritable: err.name };
  }
}

/** What `resolveTarget` says about `p`, or the name of what it threw. */
async function ours(p: string): Promise<string> {
  try {
    return await resolveTarget(p);
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    return `threw ${err.name}`;
  }
}

/**
 * The share of layouts the kernel may refuse to write before the run counts as
 * having tested too little: a generator change that made most layouts
 * unwritable — each one skipped, since a refused write cannot be an escape —
 * fails here instead of passing on the few left.
 *
 * Measured at 122 of 288 (42%), all `NotFound`, with Deno 2.9.8 on macOS: under the
 * task's scoped flags Deno refuses to write through a link to an absent file in
 * another folder, which `-A` writes through, so those layouts are skipped.
 */
const MAX_UNWRITABLE_SHARE = 0.5;

symlinkTest("resolveTarget agrees with the kernel on every generated layout", async () => {
  const all = layouts();
  const disagreements: string[] = [];
  const unwritable = new Map<string, number>();

  for (const layout of all) {
    const root = await Deno.makeTempDir({ prefix: "diff-" });
    const proj = join(root, "proj");
    const outside = join(root, "outside");
    await Deno.mkdir(proj);
    await Deno.mkdir(outside);
    try {
      await layout.build(proj, outside);
      const p = join(proj, "d", "leaf.md");
      const said = await ours(p);
      const truth = await whereAWriteLands(p);
      // A path the kernel refuses to write is one our guard may answer either
      // way — it cannot be an escape. It is counted, never silently skipped.
      if (typeof truth !== "string") {
        unwritable.set(truth.unwritable, (unwritable.get(truth.unwritable) ?? 0) + 1);
      } else if (said !== truth) {
        disagreements.push(`${layout.name}\n    ours:  ${said}\n    truth: ${truth}`);
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }

  const skipped = [...unwritable.values()].reduce((a, b) => a + b, 0);
  const why = [...unwritable].map(([name, n]) => `${name} ${n}`).join(", ");
  assertEquals(
    disagreements,
    [],
    `${disagreements.length} of ${all.length} layouts resolve somewhere other than where a write lands:\n\n` +
      disagreements.join("\n\n"),
  );
  assert(
    skipped <= all.length * MAX_UNWRITABLE_SHARE,
    `${skipped} of ${all.length} layouts are unwritable (${why}): the generator tests too little`,
  );
});
