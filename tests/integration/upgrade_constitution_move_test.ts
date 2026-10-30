import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { join } from "@std/path";
import { runSpecnaut } from "../helpers/run_specnaut.ts";
import { appendLock, lockText } from "./_lock_fixture.ts";
import {
  CONSTITUTION_PATH,
  LEGACY_CONSTITUTION_PATH,
} from "../../src/domain/constitution_paths.ts";

/**
 * Spec 038, FR-006/FR-007: a project from before the move keeps its
 * constitution — the same bytes at `docs/constitution.md`, the old address
 * gone — and every refusal leaves both files exactly as they were (SC-002).
 *
 * The project is planted as a past release left it: the old file on disk and
 * in the lock, recorded as the shipped placeholder, and no new file. A lock
 * row for the old file is the trap: refused but still locked, it is an orphan,
 * and a vanilla orphan is deleted.
 */

const PLACEHOLDER = "# Project Constitution\n\n## Principles\n\n(none defined yet)\n";
const OURS = "# Acme rules\r\n\r\n## Ship small\r\n\r\nCheck: every change is reviewed.\r\n";

async function withProject(ai: string, fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-move-" });
  try {
    const r = await runSpecnaut(
      ["init", "--here", "--no-git", "--ai", ai, "--backlog", "local"],
      { cwd: dir },
    );
    assertEquals(r.code, 0, r.stderr);
    // Before spec 038 there was no docs/constitution.md, on disk or locked.
    await Deno.remove(join(dir, CONSTITUTION_PATH));
    const lock = await lockText(dir);
    await Deno.writeTextFile(
      join(dir, ".specnaut/installed.lock"),
      lock.replace(/^ {2}docs\/constitution\.md:\n(?: {4}.*\n)*/m, ""),
    );
    await appendLock(dir, [[LEGACY_CONSTITUTION_PATH, PLACEHOLDER]]);
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const at = (dir: string, rel: string) => join(dir, rel);
const bytes = (dir: string, rel: string) => Deno.readFile(at(dir, rel));
const upgrade = (dir: string, ...flags: string[]) =>
  runSpecnaut(["upgrade", ...flags], { cwd: dir });

async function plantLegacy(dir: string, content: string | Uint8Array) {
  if (typeof content === "string") {
    await Deno.writeTextFile(at(dir, LEGACY_CONSTITUTION_PATH), content);
  } else await Deno.writeFile(at(dir, LEGACY_CONSTITUTION_PATH), content);
}

async function plantCurrent(dir: string, content: string) {
  await Deno.mkdir(at(dir, "docs"), { recursive: true });
  await Deno.writeTextFile(at(dir, CONSTITUTION_PATH), content);
}

/**
 * Whether a mode-000 file still reads — as root, or on Windows, where `chmod`
 * is not supported. There the unreadable cases have nothing to observe.
 */
async function modeIsIgnored(): Promise<boolean> {
  if (Deno.build.os === "windows") return true;
  const probe = await Deno.makeTempFile({ prefix: "specnaut-mode-" });
  try {
    await Deno.chmod(probe, 0o000);
    return await Deno.readFile(probe).then(() => true, () => false);
  } finally {
    await Deno.remove(probe);
  }
}
const MODE_IGNORED = await modeIsIgnored();

/** Plants the old file unreadable, runs `fn`, and gives the mode back for cleanup. */
async function withUnreadableLegacy(dir: string, fn: () => Promise<void>) {
  await plantLegacy(dir, OURS);
  await Deno.chmod(at(dir, LEGACY_CONSTITUTION_PATH), 0o000);
  try {
    await fn();
  } finally {
    await Deno.chmod(at(dir, LEGACY_CONSTITUTION_PATH), 0o644);
  }
  assertEquals(await Deno.readTextFile(at(dir, LEGACY_CONSTITUTION_PATH)), OURS);
}

for (const ai of ["claude", "codex"]) {
  for (const [label, content] of [["placeholder", PLACEHOLDER], ["customised", OURS]]) {
    Deno.test(`${ai}: upgrade moves the ${label} constitution byte for byte`, async () => {
      await withProject(ai, async (dir) => {
        await plantLegacy(dir, content);
        const before = await bytes(dir, LEGACY_CONSTITUTION_PATH);
        const r = await upgrade(dir);
        assertEquals(r.code, 0, r.stderr);
        assertEquals(await bytes(dir, CONSTITUTION_PATH), before);
        assertEquals(await exists(at(dir, LEGACY_CONSTITUTION_PATH)), false);
        assertStringIncludes(r.stdout, `${LEGACY_CONSTITUTION_PATH} moved to ${CONSTITUTION_PATH}`);
        assert(!(await lockText(dir)).includes(LEGACY_CONSTITUTION_PATH), "stale lock row");

        // SC-003: a second upgrade and a forced one leave it byte-identical.
        for (const flags of [[], ["--force"]]) {
          const again = await upgrade(dir, ...flags);
          assertEquals(again.code, 0, again.stderr);
          assertEquals(await bytes(dir, CONSTITUTION_PATH), before, flags.join(" "));
        }
      });
    });
  }

  Deno.test(`${ai}: a conflict is refused, both files kept, even forced with a locked placeholder`, async () => {
    await withProject(ai, async (dir) => {
      await plantLegacy(dir, PLACEHOLDER);
      await plantCurrent(dir, OURS);
      for (const flags of [[], ["--force"]]) {
        const r = await upgrade(dir, ...flags);
        assertEquals(r.code, 0, r.stderr);
        assertStringIncludes(r.stdout, `${LEGACY_CONSTITUTION_PATH} is not moved`);
        assertEquals(await Deno.readTextFile(at(dir, LEGACY_CONSTITUTION_PATH)), PLACEHOLDER);
        assertEquals(await Deno.readTextFile(at(dir, CONSTITUTION_PATH)), OURS);
      }
    });
  });

  Deno.test(`${ai}: the same text up to CRLF is a dedupe`, async () => {
    await withProject(ai, async (dir) => {
      await plantLegacy(dir, OURS);
      await plantCurrent(dir, OURS.replaceAll("\r\n", "\n").trimEnd());
      const r = await upgrade(dir);
      assertEquals(r.code, 0, r.stderr);
      assertEquals(await exists(at(dir, LEGACY_CONSTITUTION_PATH)), false);
      assertEquals(
        await Deno.readTextFile(at(dir, CONSTITUTION_PATH)),
        OURS.replaceAll("\r\n", "\n").trimEnd(),
      );
    });
  });

  Deno.test(`${ai}: a lossy old file is refused and the default never shadows it`, async () => {
    await withProject(ai, async (dir) => {
      const lossy = new Uint8Array([0x23, 0x20, 0x41, 0xc3, 0x28, 0x0a]);
      await plantLegacy(dir, lossy);
      const r = await upgrade(dir, "--force");
      assertEquals(r.code, 0, r.stderr);
      assertStringIncludes(r.stdout, "not valid UTF-8");
      assertEquals(await bytes(dir, LEGACY_CONSTITUTION_PATH), lossy);
      assertEquals(await exists(at(dir, CONSTITUTION_PATH)), false);
    });
  });

  Deno.test({
    name: `${ai}: a linked old file is refused, the link kept`,
    ignore: Deno.build.os === "windows",
    fn: async () => {
      await withProject(ai, async (dir) => {
        await Deno.writeTextFile(at(dir, "rules.md"), OURS);
        await Deno.symlink("../../rules.md", at(dir, LEGACY_CONSTITUTION_PATH));
        const r = await upgrade(dir, "--force");
        assertEquals(r.code, 0, r.stderr);
        assertStringIncludes(r.stdout, "is a link");
        assertEquals((await Deno.lstat(at(dir, LEGACY_CONSTITUTION_PATH))).isSymlink, true);
        assertEquals(await exists(at(dir, CONSTITUTION_PATH)), false);
        assertEquals(await Deno.readTextFile(at(dir, "rules.md")), OURS);
      });
    },
  });

  Deno.test(`${ai}: a preserved old file moves anyway, with a note to drop the line`, async () => {
    await withProject(ai, async (dir) => {
      await plantLegacy(dir, OURS);
      await Deno.writeTextFile(
        at(dir, ".specnaut/preserve.yml"),
        `preserved:\n  - ${LEGACY_CONSTITUTION_PATH}\n`,
      );
      const r = await upgrade(dir);
      assertEquals(r.code, 0, r.stderr);
      assertEquals(await Deno.readTextFile(at(dir, CONSTITUTION_PATH)), OURS);
      assertStringIncludes(r.stderr, "remove the line from .specnaut/preserve.yml");
      assert(!r.stderr.includes("not a managed file"), r.stderr);
    });
  });

  Deno.test(`${ai}: --dry-run says "would move" and changes nothing (SC-008)`, async () => {
    await withProject(ai, async (dir) => {
      await plantLegacy(dir, OURS);
      const lock = await lockText(dir);
      const r = await upgrade(dir, "--dry-run");
      assertEquals(r.code, 0, r.stderr);
      const mentions = r.stdout.split("\n").filter((l) =>
        (l.includes(CONSTITUTION_PATH) || l.includes(LEGACY_CONSTITUTION_PATH)) &&
        !l.includes("default principles")
      );
      assertEquals(mentions.length, 1, mentions.join("\n"));
      assertStringIncludes(mentions[0], `would move to ${CONSTITUTION_PATH}`);
      assertEquals(await Deno.readTextFile(at(dir, LEGACY_CONSTITUTION_PATH)), OURS);
      assertEquals(await exists(at(dir, CONSTITUTION_PATH)), false);
      assertEquals(await lockText(dir), lock);
    });
  });

  Deno.test(`${ai}: init --force on a locked legacy project moves it (A-H2)`, async () => {
    await withProject(ai, async (dir) => {
      await plantLegacy(dir, OURS);
      const r = await runSpecnaut(
        ["init", "--here", "--force", "--no-git", "--ai", ai, "--backlog", "local"],
        { cwd: dir },
      );
      assertEquals(r.code, 0, r.stderr);
      assertEquals(await Deno.readTextFile(at(dir, CONSTITUTION_PATH)), OURS);
      assertEquals(await exists(at(dir, LEGACY_CONSTITUTION_PATH)), false);
      assertStringIncludes(r.stderr, `moved to ${CONSTITUTION_PATH}`);
      const lock = await lockText(dir);
      assert(!lock.includes(CONSTITUTION_PATH) && !lock.includes(LEGACY_CONSTITUTION_PATH), lock);
    });
  });

  Deno.test({
    name: `${ai}: a docs/ link out of the project is refused as such, never "cannot be read"`,
    ignore: Deno.build.os === "windows",
    fn: async () => {
      await withProject(ai, async (dir) => {
        const outside = await Deno.makeTempDir({ prefix: "specnaut-outside-" });
        try {
          await plantLegacy(dir, OURS);
          await Deno.remove(at(dir, "docs"), { recursive: true });
          await Deno.symlink(outside, at(dir, "docs"));
          const r = await upgrade(dir, "--force");
          const said = r.stdout + r.stderr;
          assertStringIncludes(said, "refusing to touch a path that leaves the project");
          assert(!said.includes("cannot be read"), said);
          assertEquals(await Deno.readTextFile(at(dir, LEGACY_CONSTITUTION_PATH)), OURS);
          assertEquals([...Deno.readDirSync(outside)], []);
        } finally {
          await Deno.remove(outside, { recursive: true });
        }
      });
    },
  });

  for (const [cmd, out] of [["upgrade", "stdout"], ["init", "stderr"]] as const) {
    Deno.test({
      name: `${ai}: ${cmd} refuses an unreadable old file — no abort, no default beside it`,
      ignore: MODE_IGNORED,
      fn: async () => {
        await withProject(ai, async (dir) => {
          await withUnreadableLegacy(dir, async () => {
            const args = cmd === "upgrade"
              ? ["upgrade", "--force"]
              : ["init", "--here", "--force", "--no-git", "--ai", ai, "--backlog", "local"];
            const r = await runSpecnaut(args, { cwd: dir });
            assertEquals(r.code, 0, r.stderr);
            assertStringIncludes(r[out], `${LEGACY_CONSTITUTION_PATH} cannot be read`);
            assertEquals(await exists(at(dir, CONSTITUTION_PATH)), false);
          });
        });
      },
    });
  }
}
