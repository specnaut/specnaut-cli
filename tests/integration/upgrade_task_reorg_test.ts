import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { dirname, fromFileUrl, join, relative, SEPARATOR } from "@std/path";
import { findHarness } from "../../src/cli/harnesses.ts";
import { destResolver } from "../../src/application/upgrade_renames.ts";
import { bundleOptionsOf } from "../../src/application/upgrade_lock.ts";
import { parseLock, serializeLock } from "../../src/domain/installed_lock.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";
import {
  renameEndpointEntry,
  routerEndpointEntry,
  SKILL_DOC_RENAMES,
  type SkillDocRename,
  staleRouterAdvice,
} from "../../src/domain/skill_doc_renames.ts";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * Spec 037 — a 7.1 project upgrades into `/task` without losing a customised
 * doc, an addendum, or a file Specnaut never wrote.
 *
 * Every path is resolved through the harness and the rename table, never
 * spelled: a literal would be a second move list (plan § 5). As in
 * `upgrade_renamed_docs_test.ts`, assertions are on CONTENT at the address the
 * agent now reads — existence alone passes against the silent failure.
 */

const HARNESSES = ["claude", "codex", "copilot"] as const;
type Ai = typeof HARNESSES[number];

/** Strings only the planted files can produce. Invented; they name nothing real. */
const USER_EDIT = "HOUSE RULE — never merge on a Friday, do not remove";
const ADDENDUM =
  "Before step 3, run `./scripts/check-pending-migrations.sh`.\r\nStop if it fails.\n";
const SECRET = "API_TOKEN=s3cr3t-do-not-copy";

async function runSpecnaut(args: string[], cwd: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-task-reorg-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function write(dir: string, rel: string, content: string): Promise<void> {
  await Deno.mkdir(dirname(join(dir, rel)), { recursive: true });
  await Deno.writeTextFile(join(dir, rel), content);
}

const entry = (category: CoreEntry["category"], name: string): CoreEntry => ({
  category,
  name,
  suffix: null,
  content: "",
  executable: false,
});

/** One spec-037 move as it lands on this harness. */
type Move = { row: SkillDocRename; oldDest: string; newDest: string };

/**
 * A project as 7.1 left it: every spec-037 doc at its old address, on disk and
 * in the lock, the new address absent from both; the lock stamped 7.1.0.
 * `customise` names the docs (by file name) whose bytes diverge from the lock.
 */
async function projectOn71(
  dir: string,
  ai: Ai,
  opts: { customise?: ReadonlyArray<string>; customiseRouter?: boolean } = {},
): Promise<{ moves: Move[]; dest: (e: CoreEntry) => string }> {
  const init = await runSpecnaut(
    ["init", "--here", "--no-git", "--ai", ai, "--backlog", "local"],
    dir,
  );
  assertEquals(init.code, 0, `init failed: ${init.stderr}`);

  const lockPath = join(dir, ".specnaut/installed.lock");
  const lock = parseLock(await Deno.readTextFile(lockPath));
  const resolve = destResolver(findHarness(ai)!, bundleOptionsOf(lock));
  const dest = (e: CoreEntry) => resolve(e)!;
  const entries = new Map(lock.entries);

  const moves: Move[] = [];
  for (const row of SKILL_DOC_RENAMES.filter((r) => r.to.owner === "task")) {
    const oldDest = dest(renameEndpointEntry(row.from.owner, row.from.doc, row.kind));
    const newDest = dest(renameEndpointEntry(row.to.owner, row.to.doc, row.kind));
    const tracked = entries.get(newDest);
    if (tracked === undefined) continue; // not installed for this backend
    const vanilla = await Deno.readTextFile(join(dir, newDest));
    const custom = opts.customise?.includes(row.to.doc) === true;
    await write(dir, oldDest, custom ? `${vanilla}\n${USER_EDIT}\n` : vanilla);
    await Deno.remove(join(dir, newDest));
    entries.delete(newDest);
    entries.set(oldDest, { ...tracked, sha256: await sha256(vanilla) });
    moves.push({ row, oldDest, newDest });
  }
  assert(moves.length >= 16, `only ${moves.length} moves resolved — the fixture is not a 7.1 tree`);

  if (opts.customiseRouter) {
    const router = dest(routerEndpointEntry("specnaut"));
    await Deno.writeTextFile(
      join(dir, router),
      `${await Deno.readTextFile(join(dir, router))}\n${USER_EDIT}\n`,
    );
  }

  const aged = new Map([...entries].map(([d, e]) => [d, { ...e, templatesVersion: "7.1.0" }]));
  await Deno.writeTextFile(
    lockPath,
    serializeLock({ ...lock, templatesVersion: "7.1.0", entries: aged }),
  );
  return { moves, dest };
}

/** Plants a retired skill's router at its 7.1 address, customised and tracked. */
async function plantRetired(dir: string, rel: string): Promise<void> {
  const vanilla = "---\nname: retired\n---\n\n# Retired router\n";
  await write(dir, rel, `${vanilla}\n${USER_EDIT}\n`);
  const lockPath = join(dir, ".specnaut/installed.lock");
  const lock = parseLock(await Deno.readTextFile(lockPath));
  const entries = new Map(lock.entries);
  entries.set(rel, {
    sha256: await sha256(vanilla),
    installedAt: "2026-01-01T00:00:00Z",
    templatesVersion: "7.1.0",
  });
  await Deno.writeTextFile(lockPath, serializeLock({ ...lock, entries }));
}

/** Every file under `dir`, `/`-separated, with its content — the whole observable tree. */
async function snapshot(dir: string, at = dir, out = new Map<string, string>()) {
  for await (const e of Deno.readDir(at)) {
    const abs = join(at, e.name);
    if (e.isDirectory) await snapshot(dir, abs, out);
    else out.set(relative(dir, abs).split(SEPARATOR).join("/"), await Deno.readTextFile(abs));
  }
  return out;
}

const addendum = (skill: string, phase: string) => `.specnaut/addenda/${skill}/${phase}.md`;
const find = (moves: Move[], doc: string) => moves.find((m) => m.row.to.doc === doc)!;

for (const ai of HARNESSES) {
  Deno.test(`${ai}: untouched docs move, and customised plan.md and groom.md travel`, async () => {
    await withTempDir(async (dir) => {
      const { moves } = await projectOn71(dir, ai, { customise: ["plan.md", "groom.md"] });

      const up = await runSpecnaut(["upgrade"], dir);
      assertEquals(up.code, 0, `upgrade failed: ${up.stderr}\n${up.stdout}`);

      const lock = await Deno.readTextFile(join(dir, ".specnaut/installed.lock"));
      for (const { row, oldDest, newDest } of moves) {
        const moved = await Deno.readTextFile(join(dir, newDest));
        const custom = row.to.doc === "plan.md" || row.to.doc === "groom.md";
        assertEquals(
          moved.includes(USER_EDIT),
          custom,
          `${newDest}: wrong bytes at the new address`,
        );
        assertEquals(await exists(join(dir, oldDest)), false, `${oldDest} survived the move`);
        assertStringIncludes(lock, `  ${newDest}:`);
        assert(!lock.includes(`  ${oldDest}:`), `the lock still tracks ${oldDest}`);
      }
      // The reason reaches the person, once per customisation that travelled.
      const plan = find(moves, "plan.md");
      assertStringIncludes(
        up.stdout,
        `your edits to ${plan.oldDest} moved to ${plan.newDest} (${plan.row.reason})`,
      );
      assertStringIncludes(up.stdout, `your edits to ${find(moves, "groom.md").oldDest} moved`);
      assert(!up.stdout.includes(`your edits to ${find(moves, "tasks.md").oldDest}`));
    });
  });

  Deno.test(`${ai}: a customised board and sec-audit router warn until --force, then are backed up`, async () => {
    await withTempDir(async (dir) => {
      const { dest } = await projectOn71(dir, ai);
      const board = dest(entry("backlog-skill", "board"));
      const sec = dest(entry("skill", "sec-audit"));
      await plantRetired(dir, board);
      await plantRetired(dir, sec);

      const up = await runSpecnaut(["upgrade"], dir);
      assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);
      for (const rel of [board, sec]) {
        assertStringIncludes(await Deno.readTextFile(join(dir, rel)), USER_EDIT);
        assertStringIncludes(up.stdout, rel, `${rel} kept without a word`);
      }

      const forced = await runSpecnaut(["upgrade", "--force"], dir);
      assertEquals(forced.code, 0, `upgrade --force failed: ${forced.stderr}`);
      for (const rel of [board, sec]) {
        assertEquals(await exists(join(dir, rel)), false, `${rel} survived --force`);
        const backups = [...Deno.readDirSync(dirname(join(dir, rel)))]
          .filter((e) => e.name.startsWith(`${rel.split("/").pop()}.specnaut.bak`));
        assertEquals(backups.length, 1, `${rel} was removed without a backup`);
      }
    });
  });

  Deno.test(`${ai}: addenda follow their phase; both-present and unmoved phases stay`, async () => {
    await withTempDir(async (dir) => {
      await projectOn71(dir, ai);
      await write(dir, addendum("specnaut", "plan"), ADDENDUM);
      await write(dir, addendum("specnaut", "upgrade"), ADDENDUM);
      await write(dir, addendum("specnaut", "tag-version"), ADDENDUM);
      await write(dir, addendum("specnaut", "review"), "old review step\n");
      await write(dir, addendum("task", "review"), "new review step\n");

      const up = await runSpecnaut(["upgrade"], dir);
      assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

      // Byte-identical at the address `/task plan` reads, gone from the old.
      assertEquals(await Deno.readTextFile(join(dir, addendum("task", "plan"))), ADDENDUM);
      assertEquals(await exists(join(dir, addendum("specnaut", "plan"))), false);
      assertStringIncludes(up.stdout, `moved to ${addendum("task", "plan")}`);
      // The spec 033 rename's addendum moves now too.
      assertEquals(await Deno.readTextFile(join(dir, addendum("ship", "tag"))), ADDENDUM);
      assertEquals(await exists(join(dir, addendum("specnaut", "tag-version"))), false);
      // `upgrade` did not move, so neither does its addendum.
      assertEquals(await Deno.readTextFile(join(dir, addendum("specnaut", "upgrade"))), ADDENDUM);
      // Both present: neither moves, and it is said.
      assertEquals(
        await Deno.readTextFile(join(dir, addendum("specnaut", "review"))),
        "old review step\n",
      );
      assertEquals(
        await Deno.readTextFile(join(dir, addendum("task", "review"))),
        "new review step\n",
      );
      assertStringIncludes(
        up.stdout,
        `addendum ${addendum("specnaut", "review")} is not moved to ${
          addendum("task", "review")
        }: a file is already there`,
      );
    });
  });

  Deno.test(`${ai}: --dry-run reports the moves and changes nothing`, async () => {
    await withTempDir(async (dir) => {
      const { moves } = await projectOn71(dir, ai, { customise: ["plan.md"] });
      await write(dir, addendum("specnaut", "plan"), ADDENDUM);
      const before = await snapshot(dir);

      const up = await runSpecnaut(["upgrade", "--dry-run"], dir);
      assertEquals(up.code, 0, `upgrade --dry-run failed: ${up.stderr}`);

      assertEquals(await snapshot(dir), before, "a dry run changed the tree");
      assertStringIncludes(up.stdout, `would move to ${addendum("task", "plan")}`);
      assertStringIncludes(up.stdout, `your edits to ${find(moves, "plan.md").oldDest} would move`);
    });
  });

  Deno.test({
    name: `${ai}: a link at an old address is never copied through`,
    ignore: Deno.build.os === "windows",
    fn: async () => {
      await withTempDir(async (dir) => {
        const { moves } = await projectOn71(dir, ai);
        await write(dir, ".env.local", `${SECRET}\n`);
        await write(dir, ".gitignore", ".env.local\n");
        // An addendum and a renamed doc, each a link to the ignored secret.
        const link = addendum("specnaut", "plan");
        await Deno.mkdir(dirname(join(dir, link)), { recursive: true });
        await Deno.symlink(
          relative(dirname(join(dir, link)), join(dir, ".env.local")),
          join(dir, link),
        );
        const doc = find(moves, "tasks.md");
        await Deno.remove(join(dir, doc.oldDest));
        await Deno.symlink(
          relative(dirname(join(dir, doc.oldDest)), join(dir, ".env.local")),
          join(dir, doc.oldDest),
        );

        const up = await runSpecnaut(["upgrade"], dir);
        assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

        assertEquals(await exists(join(dir, addendum("task", "plan"))), false);
        assert((await Deno.lstat(join(dir, link))).isSymlink, "the addendum link was moved");
        assertStringIncludes(up.stdout, `addendum ${link} is a link`);
        assert(
          !(await Deno.readTextFile(join(dir, doc.newDest))).includes(SECRET),
          "the renamed doc was copied through its link — the secret is now a tracked file",
        );
        assertStringIncludes(up.stdout, `${doc.oldDest} is a link`);
      });
    },
  });

  Deno.test(`${ai}: a file whose bytes are not UTF-8 stays put; a BOM travels intact`, async () => {
    await withTempDir(async (dir) => {
      const { moves } = await projectOn71(dir, ai);
      // Read as text these decode lossily; written back they would not be the
      // file. A BOM decodes losslessly and must still survive the move.
      const bytes = new Uint8Array([...new TextEncoder().encode("step\n"), 0xff, 0xfe, 0x0a]);
      const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(ADDENDUM)]);
      const doc = find(moves, "tasks.md");
      await Deno.mkdir(dirname(join(dir, addendum("specnaut", "plan"))), { recursive: true });
      for (const rel of [addendum("specnaut", "plan"), doc.oldDest]) {
        await Deno.writeFile(join(dir, rel), bytes);
      }
      await Deno.writeFile(join(dir, addendum("specnaut", "review")), bom);

      const up = await runSpecnaut(["upgrade"], dir);
      assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

      assertEquals(await Deno.readFile(join(dir, addendum("specnaut", "plan"))), bytes);
      assertEquals(await exists(join(dir, addendum("task", "plan"))), false);
      assertStringIncludes(up.stdout, `addendum ${addendum("specnaut", "plan")} is not moved`);
      assertEquals(await Deno.readFile(join(dir, doc.oldDest)), bytes);
      assertStringIncludes(up.stdout, `${doc.oldDest} is not moved to ${doc.newDest}`);
      assertEquals(await Deno.readFile(join(dir, addendum("task", "review"))), bom);
    });
  });

  Deno.test(`${ai}: a file Specnaut never wrote at a new address is not overwritten`, async () => {
    await withTempDir(async (dir) => {
      const { moves, dest } = await projectOn71(dir, ai, { customise: ["plan.md"] });
      // `/task` is a common name: a project may already have its own.
      const router = dest(entry("backlog-skill", "task"));
      await write(dir, router, "# Our own task skill\n");
      // And its own file where a renamed doc is about to land.
      const plan = find(moves, "plan.md");
      await write(dir, plan.newDest, "# Our own plan notes\n");

      const up = await runSpecnaut(["upgrade"], dir);
      assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

      assertEquals(await Deno.readTextFile(join(dir, router)), "# Our own task skill\n");
      assertEquals(await Deno.readTextFile(join(dir, plan.newDest)), "# Our own plan notes\n");
      assertStringIncludes(
        up.stdout,
        `${plan.oldDest} is not moved to ${plan.newDest}: a file is already there`,
      );
      // The customisation is not lost: it stays at the old address.
      assertStringIncludes(await Deno.readTextFile(join(dir, plan.oldDest)), USER_EDIT);
    });
  });

  Deno.test(`${ai}: a customised /specnaut router from 7.1 is named by upgrade and by check`, async () => {
    await withTempDir(async (dir) => {
      const { dest } = await projectOn71(dir, ai, { customiseRouter: true });
      const router = dest(routerEndpointEntry("specnaut"));

      const up = await runSpecnaut(["upgrade"], dir);
      assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);
      assertStringIncludes(up.stdout, `${router} ${staleRouterAdvice(router)}`);

      // Durable: still said after the upgrade, until the baseline is re-taken.
      const check = await runSpecnaut(["check", "--project"], dir);
      assertStringIncludes(check.stdout, router);
      assertStringIncludes(check.stdout, staleRouterAdvice(router));
    });
  });

  Deno.test(`${ai}: an untouched /specnaut router from 7.1 is not named`, async () => {
    await withTempDir(async (dir) => {
      const { dest } = await projectOn71(dir, ai);
      const advice = staleRouterAdvice(dest(routerEndpointEntry("specnaut")));
      const up = await runSpecnaut(["upgrade"], dir);
      assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);
      assert(!up.stdout.includes(advice), "an untouched router was reported as customised");
      const check = await runSpecnaut(["check", "--project"], dir);
      assert(!check.stdout.includes(advice), "check named an untouched router");
    });
  });
}
