import { assert, assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  assertInsideProject,
  assertLinkTargetInProject,
  assertRemovableInProject,
  locate,
  resolveProjectRoot,
} from "../../src/infrastructure/fs_containment.ts";
import {
  ContainmentRefusal,
  LoopRefusal,
  UnwalkableRefusal,
} from "../../src/infrastructure/fs_refusals.ts";
import { symlinkTest } from "../helpers/link_text.ts";

/**
 * Containment's one answer (cli#692): `locate` tags a path `inside`, `leaves`,
 * `unwalkable` or `loop`, and each `assert*` turns every tag but `inside` into
 * its refusal. The refusal paths of `assertRemovableInProject` and
 * `assertLinkTargetInProject` had no direct test (cli#690); they are here, for
 * both an unwalkable link and a cycle.
 */

type Box = { proj: string; real: string; outside: string };

/**
 * A project beside an `outside/` sibling, holding the three broken shapes every
 * test below reaches for: `cyc-a` ⇄ `cyc-b` (a cycle), `dangling -> nope` (a
 * link through a directory that does not exist), and `.claude/` (a real folder
 * for a link's parent). `real` is the project as `resolveProjectRoot` sees it.
 */
async function withBox(fn: (b: Box) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "verdict-" });
  const proj = join(root, "proj");
  const outside = join(root, "outside");
  try {
    await Deno.mkdir(join(proj, ".claude"), { recursive: true });
    await Deno.mkdir(outside);
    await Deno.writeTextFile(join(outside, "victim.md"), "x");
    await Deno.symlink(join(proj, "cyc-b"), join(proj, "cyc-a"));
    await Deno.symlink(join(proj, "cyc-a"), join(proj, "cyc-b"));
    await Deno.symlink("nope", join(proj, "dangling"));
    await Deno.symlink(join(outside, "victim.md"), join(proj, "out.md"));
    await fn({ proj, real: await resolveProjectRoot(proj), outside: await Deno.realPath(outside) });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

symlinkTest(
  "locate a target: inside, leaves, unwalkable and loop",
  () =>
    withBox(async ({ proj, real, outside }) => {
      assertEquals(await locate(real, join(proj, "new.md"), "target"), {
        kind: "inside",
        resolved: join(real, "new.md"),
      });
      assertEquals(await locate(real, join(proj, "out.md"), "target"), {
        kind: "leaves",
        resolved: join(outside, "victim.md"),
      });
      assertEquals(await locate(real, join(proj, "dangling/x.md"), "target"), {
        kind: "unwalkable",
        missing: join(proj, "dangling"),
      });
      assertEquals(await locate(real, join(proj, "cyc-a"), "target"), { kind: "loop" });
    }),
);

symlinkTest(
  "locate an entry: the leaf as is, its ancestors walked",
  () =>
    withBox(async ({ proj, real }) => {
      // A leaf link out of the project is itself inside it: removing it touches nothing outside.
      assertEquals(await locate(real, join(proj, "out.md"), "entry"), {
        kind: "inside",
        resolved: join(real, "out.md"),
      });
      assertEquals(await locate(real, join(proj, "dangling/x.md"), "entry"), {
        kind: "unwalkable",
        missing: join(proj, "dangling"),
      });
      assertEquals(await locate(real, join(proj, "cyc-a/x.md"), "entry"), { kind: "loop" });
    }),
);

symlinkTest(
  "locate a link to be written: its text walked from its folder",
  () =>
    withBox(async ({ proj, real }) => {
      const at = join(proj, ".claude/CLAUDE.md");
      assertEquals(await locate(real, at, { linkText: "../AGENTS.md" }), {
        kind: "inside",
        resolved: join(real, "AGENTS.md"),
      });
      assertEquals((await locate(real, at, { linkText: "../../elsewhere.md" })).kind, "leaves");
      assertEquals(await locate(real, at, { linkText: "nope/AGENTS.md" }), {
        kind: "unwalkable",
        missing: join(real, ".claude/nope"),
      });
      assertEquals(await locate(real, at, { linkText: "../cyc-a/x.md" }), { kind: "loop" });
    }),
);

symlinkTest(
  "assertRemovableInProject refuses an unwalkable ancestor and a cycle by name",
  () =>
    withBox(async ({ proj, real }) => {
      const unwalkable = await assertRejects(
        () => assertRemovableInProject(real, join(proj, "dangling/x.md")),
        UnwalkableRefusal,
      );
      assert(unwalkable.message.includes(`missing: ${join(proj, "dangling")}`), unwalkable.message);
      const loop = await assertRejects(
        () => assertRemovableInProject(real, join(proj, "cyc-a/x.md")),
        LoopRefusal,
      );
      assert(loop.message.includes(join(proj, "cyc-a/x.md")), loop.message);
    }),
);

symlinkTest(
  "assertLinkTargetInProject refuses an unwalkable text and a cycle by name",
  () =>
    withBox(async ({ proj, real }) => {
      const at = join(proj, ".claude/CLAUDE.md");
      const unwalkable = await assertRejects(
        () => assertLinkTargetInProject(real, at, "nope/AGENTS.md"),
        UnwalkableRefusal,
      );
      assert(unwalkable.message.includes(`missing: ${join(real, ".claude/nope")}`));
      const loop = await assertRejects(
        () => assertLinkTargetInProject(real, at, "../cyc-a/x.md"),
        LoopRefusal,
      );
      assert(loop.message.includes(at), loop.message);
    }),
);

symlinkTest(
  "a cycle is a LoopRefusal, still a ContainmentRefusal to every caller",
  () =>
    withBox(async ({ proj, real }) => {
      const err = await assertRejects(() => assertInsideProject(real, join(proj, "cyc-a")));
      assertInstanceOf(err, LoopRefusal);
      assertInstanceOf(err, ContainmentRefusal);
      assertEquals(err.name, "LoopRefusal");
      const unwalkable = await assertRejects(() =>
        assertInsideProject(real, join(proj, "dangling/x.md"))
      );
      assertInstanceOf(unwalkable, UnwalkableRefusal);
      assertEquals(unwalkable.name, "UnwalkableRefusal");
    }),
);
