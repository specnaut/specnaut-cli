import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { filterInitBundle } from "../../src/application/init_bundle_filter.ts";
import type { Bundle } from "../../src/domain/template.ts";
import { locate, resolveProjectRoot } from "../../src/infrastructure/fs_containment.ts";
import { DenoFsReader } from "../../src/infrastructure/fs_reader.ts";
import { WINDOWS } from "../helpers/link_text.ts";
import { RUNS_AS_ROOT } from "../helpers/posix_modes.ts";
import { fakeWriter } from "../application/upgrade_fakes.ts";

/**
 * cli#719: a link out of the project whose landing this process may not enter
 * threw a raw `PermissionDenied`, so `hostRefusal` told the user to make the file
 * readable, and an agent could act on that by opening the folder the link points
 * at. Once a followed link has left the project this is a containment verdict.
 * The same denial inside the project is still a permission to fix.
 *
 * POSIX only, because mode 0o000 is how the folder refuses, and not as root.
 */

const POSIX = { ignore: WINDOWS || RUNS_AS_ROOT };

async function withLockedFolder(
  under: "project" | "outside",
  fn: (proj: string, locked: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "denied-landing-" }));
  const proj = join(root, "proj");
  const locked = join(under === "project" ? proj : join(root, "outside"), "locked");
  await Deno.mkdir(proj);
  await Deno.mkdir(locked, { recursive: true });
  await Deno.chmod(locked, 0o000);
  try {
    await fn(proj, locked);
  } finally {
    await Deno.chmod(locked, 0o755);
    await Deno.remove(root, { recursive: true });
  }
}

/** Both ways a walk meets the folder: its last segment, and a segment on the way through. */
for (const [label, tail] of [["the leaf", "x"], ["an ancestor", "sub/x"]]) {
  Deno.test(
    `a link out, denied at ${label}, leaves the project`,
    POSIX,
    () =>
      withLockedFolder("outside", async (proj, locked) => {
        const abs = join(proj, "config.toml");
        await Deno.symlink(join(locked, tail), abs);
        const v = await locate(await resolveProjectRoot(proj), abs, "target");
        assertEquals(v.kind, "leaves");
        assert(v.kind === "leaves");
        assertStringIncludes(v.resolved, locked);
      }),
  );
}

Deno.test(
  "the same denial inside the project is still the permission it is",
  POSIX,
  () =>
    withLockedFolder("project", async (proj, locked) => {
      const abs = join(proj, "config.toml");
      await Deno.symlink(join(locked, "x"), abs);
      const err = await assertRejects(
        async () => await locate(await resolveProjectRoot(proj), abs, "target"),
      );
      assertInstanceOf(err, Deno.errors.PermissionDenied);
    }),
);

const bundle: Bundle = {
  "config.toml": {
    content: "a = 1",
    executable: false,
    mergeBlock: "x",
    mergeRefuseIf: { pattern: "^\\[agents\\]", message: "add the agent keys by hand" },
  },
  "a.md": { content: "alpha", executable: false },
};

const filtered = (proj: string) =>
  filterInitBundle(
    { reader: new DenoFsReader(), writer: fakeWriter(), dryRun: false },
    proj,
    bundle,
    new Set(),
  );

Deno.test(
  "a merge host linked out, into a folder no one may enter, is refused as a refusal",
  POSIX,
  () =>
    withLockedFolder("outside", async (proj, locked) => {
      await Deno.symlink(join(locked, "x"), join(proj, "config.toml"));
      const r = await filtered(proj);
      assertEquals(Object.keys(r.bundleToWrite), ["a.md"]);
      assertEquals(r.refusals.length, 1, r.refusals.join("\n"));
      assertStringIncludes(r.refusals[0], "config.toml was refused");
      assertStringIncludes(r.refusals[0], "leaves the project");
      assert(!r.refusals[0].includes("make it readable"), r.refusals[0]);
    }),
);

Deno.test(
  "a merge host linked inside, into a folder denied to us, can be made readable",
  POSIX,
  () =>
    withLockedFolder("project", async (proj, locked) => {
      await Deno.symlink(join(locked, "x"), join(proj, "config.toml"));
      const r = await filtered(proj);
      assertEquals(Object.keys(r.bundleToWrite), ["a.md"]);
      assertEquals(r.refusals.length, 1, r.refusals.join("\n"));
      assertStringIncludes(r.refusals[0], "config.toml cannot be read");
    }),
);
