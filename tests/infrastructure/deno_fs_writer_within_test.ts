import { assertEquals } from "@std/assert";
import { exists } from "@std/fs/exists";
import { join } from "@std/path";
import { DenoFsWriter } from "../../src/infrastructure/deno_fs_writer.ts";
import { orphanScope } from "../../src/domain/orphan_scope.ts";

/**
 * `deletePaths`' `within` (cli#665), against real symlinks. The plan reads only
 * the path's text, so a committed link under a managed folder is invisible to
 * it: these are the cases a lexical check passes and the writer must refuse.
 */

const ROOTS = [".claude/skills/"];

/** Needs `Deno.symlink`, which Windows refuses without Developer Mode or elevation —
 * registered as IGNORED there, never short-circuited into a pass (see the prune test). */
const WINDOWS = Deno.build.os === "windows";
const within = (rel: string) => orphanScope(rel, ROOTS) === "in-scope";

async function project(files: Record<string, string>, links: Record<string, string>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-within-" });
  for (const [rel, body] of Object.entries(files)) {
    await Deno.mkdir(join(dir, rel, ".."), { recursive: true });
    await Deno.writeTextFile(join(dir, rel), body);
  }
  for (const [rel, target] of Object.entries(links)) {
    await Deno.mkdir(join(dir, rel, ".."), { recursive: true });
    await Deno.symlink(target, join(dir, rel));
  }
  return dir;
}

for (
  const c of [
    { name: "project source", link: "../../src", file: "src/app.ts", via: "app.ts" },
    { name: ".git", link: "../../.git", file: ".git/HEAD", via: "HEAD" },
  ]
) {
  Deno.test({
    name: `a delete that reaches ${c.name} through a link under a managed root is refused`,
    ignore: WINDOWS,
  }, async () => {
    const dir = await project({ [c.file]: "keep\n" }, { ".claude/skills/s": c.link });
    try {
      const dest = `.claude/skills/s/${c.via}`;
      for (const backupExisting of [false, true]) {
        const report = await new DenoFsWriter().deletePaths([dest], dir, {
          backupExisting,
          within,
        });
        assertEquals(report.refused, [dest]);
        assertEquals(report.backups, []);
        assertEquals(await Deno.readTextFile(join(dir, c.file)), "keep\n");
        assertEquals((await Deno.lstat(join(dir, ".claude/skills/s"))).isSymlink, true);
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
}

Deno.test({
  name: "a delete through an in-scope link goes ahead, and the emptied link is not pruned",
  ignore: WINDOWS,
}, async () => {
  // The link resolves into another managed folder: in scope, so the file goes.
  // Its target folder is now empty, and the walk must stop at the link rather
  // than delete what the project committed.
  const dir = await project(
    { ".specnaut/scripts/shared/x.md": "old\n" },
    { ".claude/skills/shared": "../../.specnaut/scripts/shared" },
  );
  try {
    const dest = ".claude/skills/shared/x.md";
    const report = await new DenoFsWriter().deletePaths([dest], dir, {
      backupExisting: false,
      within,
    });
    assertEquals(report.refused, []);
    assertEquals(await exists(join(dir, ".specnaut/scripts/shared/x.md")), false);
    assertEquals((await Deno.lstat(join(dir, ".claude/skills/shared"))).isSymlink, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test({
  name: "without within, deletePaths behaves as before: inside the project is enough",
  ignore: WINDOWS,
}, async () => {
  const dir = await project({ "src/app.ts": "x\n" }, { ".claude/skills/s": "../../src" });
  try {
    const report = await new DenoFsWriter().deletePaths([".claude/skills/s/app.ts"], dir, {
      backupExisting: false,
    });
    assertEquals(report.refused, []);
    assertEquals(await exists(join(dir, "src/app.ts")), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test({
  name: "an emptied folder that cannot be removed is reported, not swallowed",
  // POSIX permission bits. Root ignores them, but asking the uid needs
  // --allow-sys, which `deno task test` does not grant; no CI runner is root.
  ignore: WINDOWS,
}, async () => {
  const dir = await project({ ".claude/skills/old/x.md": "old\n" }, {});
  const skills = join(dir, ".claude/skills");
  try {
    // `old/` stays writable, so the file goes; `skills/` does not, so `old/`
    // cannot be removed after it — the error the walk used to swallow.
    await Deno.chmod(skills, 0o555);
    const report = await new DenoFsWriter().deletePaths([".claude/skills/old/x.md"], dir, {
      backupExisting: false,
    });
    assertEquals(await exists(join(skills, "old/x.md")), false);
    assertEquals(report.notes?.length, 1);
    assertEquals(report.notes?.[0].startsWith("could not remove the emptied folder"), true);
  } finally {
    await Deno.chmod(skills, 0o755);
    await Deno.remove(dir, { recursive: true });
  }
});
