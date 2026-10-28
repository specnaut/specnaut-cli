import { assert, assertEquals, assertRejects } from "@std/assert";
import { join, SEPARATOR } from "@std/path";
import { DenoFsWriter } from "../../src/infrastructure/deno_fs_writer.ts";

/**
 * Registers a test that needs `Deno.symlink`.
 *
 * Windows refuses symlink creation without Developer Mode or elevation, so
 * every fixture in this file fails there for a reason that has nothing to do
 * with the code under test. Registered as IGNORED rather than short-circuited
 * inside the body: a test that returns early reports as PASSED, and a green
 * that never ran is the exact failure this whole feature is about.
 *
 * The consequence is stated rather than hidden: **containment is not covered on
 * Windows.** The code is platform-neutral by construction — `relative()` and
 * `@std/path` throughout, never a hardcoded separator — but that is an argument,
 * not a measurement. `write_bundle_symlink_test.ts` has skipped Windows the same
 * way since before this change.
 */
const WINDOWS = Deno.build.os === "windows";
function symlinkTest(name: string, fn: () => Promise<void>): void {
  Deno.test({ name, ignore: WINDOWS, fn });
}

/**
 * The escapes cli#574 measured, at the sink rather than at the predicate.
 *
 * Every case asserts TWO things: that the command refused, AND that the file
 * outside the project is byte-unchanged. Asserting only the refusal would pass
 * against a guard that refuses after acting — which is the shape of half the
 * defects this project has already found in its own guards.
 */
async function box(): Promise<{ root: string; proj: string; outside: string }> {
  const root = await Deno.makeTempDir({ prefix: "escape-" });
  const proj = join(root, "proj");
  const outside = join(root, "outside");
  await Deno.mkdir(proj);
  await Deno.mkdir(outside);
  return { root, proj, outside };
}

const w = new DenoFsWriter();

symlinkTest("shape A — a symlinked ancestor cannot receive a write", async () => {
  const { root, proj, outside } = await box();
  try {
    await Deno.symlink(outside, join(proj, ".claude"));
    await assertRejects(() =>
      w.writeBundle({ ".claude/x.md": { content: "A", executable: false } }, proj, {
        overwrite: true,
        backupExisting: false,
      })
    );
    assertEquals(
      await Deno.stat(join(outside, "x.md")).then(() => true).catch(() => false),
      false,
      "nothing may be created at the link's target",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("shape A' — mkdir -p may not create directories through the link either", async () => {
  // The sink the plan's first version omitted, and the reason the check moved
  // ahead of `mkdir`. Damage is bounded — empty directories, no content — but a
  // guard blind to a sink it never reads is the class this change closes.
  const { root, proj, outside } = await box();
  try {
    await Deno.symlink(outside, join(proj, ".claude"));
    await assertRejects(() =>
      w.writeBundle(
        { ".claude/skills/deep/SKILL.md": { content: "A", executable: false } },
        proj,
        { overwrite: true, backupExisting: false },
      )
    );
    assertEquals(
      await Deno.stat(join(outside, "skills")).then(() => true).catch(() => false),
      false,
      "not even a directory may be created at the link's target",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("shape B — a leaf symlink cannot be written through", async () => {
  // The case the plan's first algorithm allowed: the parent is a normal
  // in-project directory, so resolve-the-parent-and-append-the-leaf says
  // "inside" and the write lands on the victim.
  const { root, proj, outside } = await box();
  try {
    const victim = join(outside, "victim.md");
    await Deno.writeTextFile(victim, "ORIGINAL");
    await Deno.symlink(victim, join(proj, "y.md"));
    await assertRejects(() =>
      w.writeBundle({ "y.md": { content: "B", executable: false } }, proj, {
        overwrite: true,
        backupExisting: false,
      })
    );
    assertEquals(await Deno.readTextFile(victim), "ORIGINAL");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("shape B' — an executable dest cannot be chmodded through a link", async () => {
  const { root, proj, outside } = await box();
  try {
    const victim = join(outside, "victim.sh");
    await Deno.writeTextFile(victim, "ORIGINAL");
    await Deno.chmod(victim, 0o600);
    await Deno.symlink(victim, join(proj, "s.sh"));
    await assertRejects(() =>
      w.writeBundle({ "s.sh": { content: "B", executable: true } }, proj, {
        overwrite: true,
        backupExisting: false,
      })
    );
    assertEquals(await Deno.readTextFile(victim), "ORIGINAL");
    const mode = (await Deno.stat(victim)).mode ?? 0;
    assertEquals(mode & 0o777, 0o600, "and its mode is untouched");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("shape C — a delete cannot reach through a symlinked ancestor", async () => {
  const { root, proj, outside } = await box();
  try {
    await Deno.writeTextFile(join(outside, "z.md"), "keep");
    await Deno.symlink(outside, join(proj, ".claude"));
    await assertRejects(() => w.deletePaths([".claude/z.md"], proj, { backupExisting: false }));
    assertEquals(await Deno.readTextFile(join(outside, "z.md")), "keep");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("a backup rename cannot move a file out of the project either", async () => {
  const { root, proj, outside } = await box();
  try {
    await Deno.writeTextFile(join(outside, "z.md"), "keep");
    await Deno.symlink(outside, join(proj, ".claude"));
    await assertRejects(() => w.deletePaths([".claude/z.md"], proj, { backupExisting: true }));
    assertEquals(await Deno.readTextFile(join(outside, "z.md")), "keep");
    assertEquals(
      await Deno.stat(join(outside, "z.md.specnaut.bak")).then(() => true).catch(() => false),
      false,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("the refusal names the path, where it resolved, and the root", async () => {
  const { root, proj, outside } = await box();
  try {
    await Deno.symlink(outside, join(proj, ".claude"));
    const err = await assertRejects(() =>
      w.writeBundle({ ".claude/x.md": { content: "A", executable: false } }, proj, {
        overwrite: true,
        backupExisting: false,
      })
    );
    assert(err instanceof Error);
    assert(err.message.includes(".claude/x.md"), err.message);
    assert(err.message.includes("resolves:"), "where it went");
    assert(
      err.message.includes("project:"),
      "and against which root — a widened root is otherwise invisible",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("an ordinary project is written exactly as before", async () => {
  // The positive control. Every assertion above is a refusal, and a guard that
  // refuses everything would satisfy all of them.
  const { root, proj } = await box();
  try {
    const report = await w.writeBundle(
      {
        "a/b.md": { content: "hello\n", executable: false },
        "c.sh": { content: "#!/bin/sh\n", executable: true },
      },
      proj,
      { overwrite: true, backupExisting: false },
    );
    assertEquals(await Deno.readTextFile(join(proj, "a/b.md")), "hello\n");
    assertEquals(report.backups.length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// cli#669: a delete is judged on what `Deno.remove` / `Deno.rename` act on — the
// parent resolved, the leaf as is — not on where a leaf link points.

symlinkTest("a leaf link pointing out is removed as a link; its target is untouched", async () => {
  for (const backupExisting of [false, true]) {
    const { root, proj, outside } = await box();
    try {
      await Deno.writeTextFile(join(outside, "t.md"), "keep");
      await Deno.mkdir(join(proj, ".claude"));
      await Deno.symlink(join(outside, "t.md"), join(proj, ".claude/l.md"));
      await w.deletePaths([".claude/l.md"], proj, { backupExisting });
      const gone = await Deno.lstat(join(proj, ".claude/l.md")).then(() => false, () => true);
      assert(gone, `backupExisting=${backupExisting}: the link is still there`);
      assertEquals(await Deno.readTextFile(join(outside, "t.md")), "keep");
      if (backupExisting) {
        assert((await Deno.lstat(join(proj, ".claude/l.md.specnaut.bak"))).isSymlink);
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
});

symlinkTest("a path that lands on the project directory itself is refused", async () => {
  const { root, proj } = await box();
  try {
    await Deno.writeTextFile(join(proj, "a.md"), "keep");
    // `up/proj` is the project: `up` points at its parent.
    await Deno.symlink(root, join(proj, "up"));
    for (const dest of [".", "a/..", "up/proj"]) {
      await assertRejects(
        () => w.deletePaths([dest], proj, { backupExisting: true }),
        Error,
        undefined,
        dest,
      );
      assertEquals(await Deno.readTextFile(join(proj, "a.md")), "keep", dest);
      const aside = await Deno.lstat(`${proj}.specnaut.bak`).then(() => true, () => false);
      assertEquals(aside, false, `${dest}: the project was moved aside`);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("a `..` after a link in a link's text cannot carry a write out (cli#686)", async () => {
  // `s -> outside/deep`, `a -> s/../evil`. Lexically `s/../evil` is
  // `proj/evil`; the kernel follows `s` first and lands on `outside/evil`.
  const { root, proj, outside } = await box();
  try {
    await Deno.mkdir(join(outside, "deep"));
    await Deno.symlink(join(outside, "deep"), join(proj, "s"));
    await Deno.symlink(["s", "..", "evil"].join(SEPARATOR), join(proj, "a"));
    // The refusal must be the guard's. Without the fix the guard approves, and
    // the write then fails on its own (Deno, under this binary's permissions,
    // reports ENOENT) — a rejection that proves nothing about containment and
    // that a different runtime or flag set would not give.
    const err = await assertRejects(() =>
      w.writeBundle({ a: { content: "A", executable: false } }, proj, {
        overwrite: true,
        backupExisting: false,
      })
    );
    assert(err instanceof Error && err.message.includes("leaves the project"), String(err));
    assertEquals(
      await Deno.lstat(join(outside, "evil")).then(() => true).catch(() => false),
      false,
      "nothing may be created where the kernel resolves the link",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest(
  "a link through a directory the bundle itself creates is refused (cli#686)",
  async () => {
    // `D -> .specnaut-new/../..` is dangling until phase 1 makes `.specnaut-new/`;
    // then `AGENTS.md -> D/victim.txt` lands one level above the project.
    const { root, proj } = await box();
    try {
      await Deno.writeTextFile(join(root, "victim.txt"), "ORIGINAL\n");
      await Deno.symlink([".specnaut-new", "..", ".."].join(SEPARATOR), join(proj, "D"));
      await Deno.symlink(["D", "victim.txt"].join(SEPARATOR), join(proj, "AGENTS.md"));
      const err = await assertRejects(() =>
        w.writeBundle(
          {
            "AGENTS.md": { content: "BLOCK\n", executable: false, mergeBlock: "specnaut" },
            ".specnaut-new/x.md": { content: "y", executable: false },
          },
          proj,
          { overwrite: false },
        )
      );
      assert(err instanceof Error && err.message.includes("does not exist"), String(err));
      assertEquals(await Deno.readTextFile(join(root, "victim.txt")), "ORIGINAL\n");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);
