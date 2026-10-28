import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join, SEPARATOR } from "@std/path";
import { DenoFsWriter, type Linker } from "../../src/infrastructure/deno_fs_writer.ts";
import type { Bundle } from "../../src/domain/template.ts";
import { readLinkText, WINDOWS } from "../helpers/link_text.ts";

/**
 * The writer's context-link branch (cli#680, cli#681): a destination carrying
 * `symlinkTo` becomes a relative link, or — where the system refuses links —
 * the one-line fallback in `content`.
 */

const DEST = ".claude/CLAUDE.md";
const LINKED: Bundle = {
  [DEST]: { content: "@../AGENTS.md\n", executable: false, symlinkTo: "../AGENTS.md" },
};
const refusing = (err: Error): Linker => () => Promise.reject(err);

async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(dir, "AGENTS.md"), "# AGENTS\n");
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("a context link is written as a relative symlink that resolves to AGENTS.md", async () => {
  await withProject(async (dir) => {
    const report = await new DenoFsWriter().writeBundle(LINKED, dir, { overwrite: true });
    const abs = join(dir, DEST);
    assert((await Deno.lstat(abs)).isSymlink, "not a symlink");
    assertEquals(await readLinkText(abs), "../AGENTS.md");
    assertEquals(await Deno.readTextFile(abs), "# AGENTS\n");
    assertEquals(report.links, [{ dest: DEST, target: "../AGENTS.md", form: "symlink" }]);
  });
});

Deno.test("where links are refused, the fallback is written and the reason reported", async () => {
  await withProject(async (dir) => {
    const writer = new DenoFsWriter(refusing(new Deno.errors.PermissionDenied("no privilege")));
    const report = await writer.writeBundle(LINKED, dir, { overwrite: true });
    const abs = join(dir, DEST);
    assert(!(await Deno.lstat(abs)).isSymlink, "a link was made after all");
    assertEquals(await Deno.readTextFile(abs), "@../AGENTS.md\n");
    assertEquals(report.links?.length, 1);
    assertEquals(report.links?.[0].form, "fallback");
    assertStringIncludes(report.links?.[0].reason ?? "", "PermissionDenied: no privilege");
  });
});

Deno.test("a refusal that is not about links propagates instead of falling back", async () => {
  // NotCapable is Deno refusing a permission the binary lacks: a fallback
  // there would hide a broken build behind a working-looking project.
  await withProject(async (dir) => {
    const writer = new DenoFsWriter(refusing(new Deno.errors.NotCapable("--allow-write")));
    await assertRejects(
      () => writer.writeBundle(LINKED, dir, { overwrite: true }),
      Deno.errors.NotCapable,
    );
  });
});

Deno.test("our own link is left alone even under backupExisting — no backup, no report", {
  ignore: WINDOWS,
}, async () => {
  await withProject(async (dir) => {
    await Deno.mkdir(join(dir, ".claude"));
    await Deno.symlink("../AGENTS.md", join(dir, DEST));
    const report = await new DenoFsWriter().writeBundle(LINKED, dir, {
      overwrite: true,
      backupExisting: true,
    });
    assertEquals(report.backups, []);
    assertEquals(report.links, undefined);
    assertEquals(await readLinkText(join(dir, DEST)), "../AGENTS.md");
  });
});

Deno.test(
  "a foreign link is moved aside as a link, and ours takes its place",
  { ignore: WINDOWS },
  async () => {
    await withProject(async (dir) => {
      await Deno.mkdir(join(dir, ".claude"));
      await Deno.writeTextFile(join(dir, "OTHER.md"), "other\n");
      await Deno.symlink("../OTHER.md", join(dir, DEST));
      const report = await new DenoFsWriter().writeBundle(LINKED, dir, {
        overwrite: true,
        backupExisting: true,
      });
      assertEquals(report.backups, [{
        dest: DEST,
        backupPath: `${DEST}.specnaut.bak`,
        wasSymlink: true,
      }]);
      assertEquals(await readLinkText(join(dir, DEST)), "../AGENTS.md");
      assertEquals(await Deno.readTextFile(join(dir, "OTHER.md")), "other\n");
    });
  },
);

Deno.test("a foreign link pointing OUT of the project is replaced, not refused", {
  ignore: WINDOWS,
}, async () => {
  // Replacing a link touches the link, not its target. Judged by its target,
  // the whole bundle aborted on a link the run was about to remove.
  await withProject(async (dir) => {
    const outside = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(outside, "theirs.md"), "theirs\n");
      await Deno.mkdir(join(dir, ".claude"));
      await Deno.symlink(join(outside, "theirs.md"), join(dir, DEST));
      await new DenoFsWriter().writeBundle(LINKED, dir, { overwrite: true, backupExisting: true });
      assertEquals(await readLinkText(join(dir, DEST)), "../AGENTS.md");
      assertEquals(await Deno.readTextFile(join(outside, "theirs.md")), "theirs\n");
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  });
});

Deno.test("a plain file is replaced without a backup when none was asked for", async () => {
  await withProject(async (dir) => {
    await Deno.mkdir(join(dir, ".claude"));
    await Deno.writeTextFile(join(dir, DEST), "# generated\n");
    const report = await new DenoFsWriter().writeBundle(LINKED, dir, { overwrite: true });
    assertEquals(report.backups, []);
    assertEquals(await readLinkText(join(dir, DEST)), "../AGENTS.md");
  });
});

Deno.test("a link whose text would leave the project is refused before anything is written", async () => {
  await withProject(async (dir) => {
    const escaping: Bundle = {
      [DEST]: { content: "x\n", executable: false, symlinkTo: "../../outside.md" },
    };
    const err = await assertRejects(
      () => new DenoFsWriter().writeBundle(escaping, dir, { overwrite: true }),
      Error,
    );
    assertStringIncludes(err.message, "leaves the project");
  });
});

Deno.test({
  name: "a link text with `..` after a link is walked as the kernel walks it (cli#686)",
  ignore: WINDOWS,
  fn: () =>
    withProject(async (dir) => {
      // `s -> <outside>/deep`: lexically `../s/../evil` from `.claude/` is
      // `<dir>/evil`, inside; the kernel lands on `<outside>/evil`.
      const outside = await Deno.makeTempDir();
      try {
        await Deno.mkdir(join(outside, "deep"));
        await Deno.symlink(join(outside, "deep"), join(dir, "s"));
        const escaping: Bundle = {
          [DEST]: { content: "x\n", executable: false, symlinkTo: "../s/../evil" },
        };
        const err = await assertRejects(
          () => new DenoFsWriter().writeBundle(escaping, dir, { overwrite: true }),
          Error,
        );
        assertStringIncludes(err.message, "leaves the project");
        assertEquals(await Deno.lstat(join(dir, DEST)).then(() => true, () => false), false);
      } finally {
        await Deno.remove(outside, { recursive: true });
      }
    }),
});

Deno.test({
  name: "a dangling link as an ancestor is refused by the guard, not by mkdir (cli#686)",
  ignore: WINDOWS,
  fn: () =>
    withProject(async (dir) => {
      // `.claude -> .codex/../..` is dangling until `.codex/` exists. `.claude/x.md`
      // comes first, so it is judged while the link still dangles: containment
      // must not rest on `mkdir` happening to fail on it.
      await Deno.symlink([".codex", "..", ".."].join(SEPARATOR), join(dir, ".claude"));
      const err = await assertRejects(
        () =>
          new DenoFsWriter().writeBundle(
            {
              ".claude/x.md": { content: "x\n", executable: false },
              ".codex/x.md": { content: "y\n", executable: false },
            },
            dir,
            { overwrite: true },
          ),
        Error,
      );
      assertStringIncludes(err.message, "does not exist");
    }),
});
