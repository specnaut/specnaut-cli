import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { switchBacklogBackend } from "../../../src/cli/handlers/upgrade_handler.ts";
import { parseLock } from "../../../src/domain/installed_lock.ts";

const MAIN = fromFileUrl(new URL("../../../src/main.ts", import.meta.url));

async function runSpecnaut(
  args: string[],
  opts: { cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      MAIN,
      ...args,
    ],
    cwd: opts.cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await p.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

/**
 * Init a parent-managed child so it carries a `parent_managed: true` lock with
 * no agentic entries — the realistic precondition for a backend switch.
 */
async function initializedParentManagedChild(): Promise<{ root: string; child: string }> {
  const root = await Deno.makeTempDir({ prefix: "specnaut-switch-pm-" });
  const parent = join(root, "parent");
  const child = join(parent, "child");
  await Deno.mkdir(join(parent, ".specnaut"), { recursive: true });
  await Deno.mkdir(child, { recursive: true });
  await Deno.writeTextFile(
    join(parent, "deno.json"),
    JSON.stringify({ workspace: ["./child"] }, null, 2),
  );
  // Pin the starting backend explicitly so this switch scenario (local → github)
  // is independent of the picker's default (which is `cloud`).
  const { code, stderr } = await runSpecnaut(
    ["init", "--here", "--no-git", "--backlog", "local"],
    { cwd: child },
  );
  assertEquals(code, 0, `init precondition failed: ${stderr}`);
  return { root, child };
}

// HIGH — switching backlog backend on a parent-managed lock must preserve the
// parent-managed decision (FR-012). Dropping it silently re-enables agentic
// provisioning on the next upgrade.
Deno.test("switchBacklogBackend preserves parent_managed and excludes agentic entries", async () => {
  const { root, child } = await initializedParentManagedChild();
  try {
    const lockPath = join(child, ".specnaut/installed.lock");
    const before = parseLock(await Deno.readTextFile(lockPath));
    assertEquals(before.parentManaged, true, "precondition: lock must be parent-managed");
    assertEquals(before.backlogBackend, "local", "precondition: starts on local backend");

    const { switched, from } = await switchBacklogBackend(child, "github");
    assertEquals(switched, true);
    assertEquals(from, "local");

    const after = parseLock(await Deno.readTextFile(lockPath));
    // Backend switched...
    assertEquals(after.backlogBackend, "github");
    // ...but the parent-managed decision survived.
    assertEquals(after.parentManaged, true);
    // ...and no agentic entry was re-introduced.
    for (const dest of after.entries.keys()) {
      assert(
        !dest.startsWith(".claude/skills/") &&
          !dest.startsWith(".claude/agents/") &&
          !dest.startsWith(".claude/commands/"),
        `agentic entry leaked into lock after switch: ${dest}`,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/** Strip every entry from the lock: nothing on disk changes, only the lock's
 * ability to say whether it changed. That is the state #572 made more common,
 * and the files it makes common are the ones a user edited. */
async function stripLockEntries(child: string): Promise<void> {
  const lockPath = join(child, ".specnaut/installed.lock");
  const before = parseLock(await Deno.readTextFile(lockPath));
  await Deno.writeTextFile(
    lockPath,
    JSON.stringify(
      {
        version: 2,
        harness: before.harness,
        backlog_backend: before.backlogBackend,
        version_scheme: before.versionScheme,
        spec_backend: before.specBackend,
        templates_version: before.templatesVersion,
        ...(before.parentManaged ? { parent_managed: true } : {}),
        files: {},
      },
      null,
      2,
    ),
  );
}

/** A plain project, NOT parent-managed. The distinction is load-bearing for the
 * backup assertion: a parent-managed child excludes agentic entries, so nothing
 * `writeBundle` writes during a backend switch pre-exists, and the backup flag
 * is unobservable there. `.claude/skills/task/backlog.md` ships under both
 * backends, so in a plain project the switch overwrites it — which is the only
 * shape where "was it backed up" is a question with an answer. */
async function initializedPlainProject(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-switch-plain-" });
  const { code, stderr } = await runSpecnaut(
    ["init", "--here", "--no-git", "--backlog", "local"],
    { cwd: dir },
  );
  assertEquals(code, 0, `init precondition failed: ${stderr}`);
  return dir;
}

async function bakFiles(dir: string, out: string[] = []): Promise<string[]> {
  for await (const entry of Deno.readDir(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory) await bakFiles(full, out);
    else if (entry.name.endsWith(".specnaut.bak")) out.push(full);
  }
  return out;
}

// #572 — the customization guard must FAIL CLOSED, and the escape it advertises
// must both exist and keep its promise. Three mechanisms, and each needs its own
// witness: reverting the guard to `continue`, unwiring `--force` at the call
// site, and dropping the backup all left the suite green at different times.
Deno.test("switchBacklogBackend refuses a dest the lock cannot speak for", async () => {
  const { root, child } = await initializedParentManagedChild();
  try {
    await stripLockEntries(child);

    let refused = false;
    try {
      await switchBacklogBackend(child, "github");
    } catch (err) {
      refused = true;
      assert(err instanceof Error);
      assert(
        err.message.includes("refusing to switch backlog backend"),
        `unexpected error: ${err.message}`,
      );
    }
    assert(refused, "absence of evidence is not evidence of vanilla");

    // The forced switch clears the guard.
    const { switched } = await switchBacklogBackend(child, "github", true);
    assertEquals(switched, true, "--force must clear the guard");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// The backup the refusal promises. Separate test and a PLAIN project, because
// the message says "existing files are backed up to *.specnaut.bak" and the
// write passed `false` — inert only while the force path was unreachable, which
// is exactly what wiring `--force` changed. Called directly so nothing else
// runs: a full upgrade backs files up for its own reasons and the assertion
// could not tell whose backup it found.
Deno.test("a forced backend switch backs up what it overwrites", async () => {
  const dir = await initializedPlainProject();
  try {
    const overwritten = join(dir, ".claude/skills/task/backlog.md");
    const original = await Deno.readTextFile(overwritten);
    await stripLockEntries(dir);

    const { switched } = await switchBacklogBackend(dir, "github", true);
    assertEquals(switched, true);

    const bak = `${overwritten}.specnaut.bak`;
    assertEquals(
      (await bakFiles(dir)).includes(bak),
      true,
      "the file the switch overwrote must have a .specnaut.bak beside it",
    );
    assertEquals(
      await Deno.readTextFile(bak),
      original,
      "and the backup must hold what was there before, not what replaced it",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// The other half of the same promise, and the one that was never watched: a
// backend switch DELETES the files the old backend owned. `.specnaut/backlog.md`
// is the whole local backlog, and until this branch the delete passed
// `backupExisting: false` — switching to github removed it outright, with no
// copy and no line in the summary. The overwrite test above cannot see this:
// `writeBundle` and `deletePaths` carry separate flags, and flipping the delete
// one back to `false` left all 1488 tests green. No `--force` here on purpose —
// this is what a plain, guard-clearing switch does by default.
Deno.test("a backend switch backs up what it deletes", async () => {
  const dir = await initializedPlainProject();
  try {
    const deleted = join(dir, ".specnaut/backlog.md");
    const original = await Deno.readTextFile(deleted);

    const { switched, backups } = await switchBacklogBackend(dir, "github");
    assertEquals(switched, true);

    assertEquals(
      await Deno.stat(deleted).then(() => true).catch(() => false),
      false,
      "precondition: the local backlog is one of the files the switch removes",
    );
    const bak = `${deleted}.specnaut.bak`;
    assertEquals(
      (await bakFiles(dir)).includes(bak),
      true,
      "the user's backlog must survive the switch as a .specnaut.bak",
    );
    assertEquals(
      await Deno.readTextFile(bak),
      original,
      "and hold every item that was in it",
    );
    // And the caller must be able to say so. A backup nobody is told about is
    // indistinguishable from a deletion, next to a line that already says
    // "items were NOT migrated automatically".
    assertEquals(
      backups.includes(".specnaut/backlog.md.specnaut.bak"),
      true,
      `the switch must report where it put the copy, got: ${JSON.stringify(backups)}`,
    );
    // …and nothing it merely rewrote. `.claude/skills/task/backlog.md` ships
    // under both backends, so this switch overwrote it — and the forced test
    // above proves that overwrite CAN produce a `.bak`. Here it must not: the
    // guard this switch cleared proves the file was vanilla, and copying aside
    // what Specnaut generated and can regenerate buried the one backup that
    // matters under thirty that do not.
    assertEquals(
      (await bakFiles(dir)).some((f) => f.endsWith("task/backlog.md.specnaut.bak")),
      false,
      "an unforced switch leaves no .bak for a vanilla file it rewrote",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// The print, separately — for the same reason the `--force` wiring needed its
// own test. `switchBacklogBackend` returning the paths proves nothing about
// whether anyone renders them: the previous version computed a full report and
// discarded it with `void report`, and no assertion at this layer noticed.
Deno.test("the CLI names the copy it kept of a deleted backlog", async () => {
  const dir = await initializedPlainProject();
  try {
    const r = await runSpecnaut(["upgrade", "--backlog", "github"], { cwd: dir });
    assertEquals(r.code, 0, `switch failed: ${r.stderr}`);
    assert(
      r.stdout.includes(".specnaut/backlog.md.specnaut.bak"),
      `stdout must name the backup, got:\n${r.stdout}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// The call site, separately. The defect was there and not in the function: the
// signature took two parameters and the caller passed two, so `--force` never
// arrived and the advertised remedy re-entered the identical throw forever. A
// direct call cannot see that — it reads as covering the flag while testing the
// signature.
Deno.test("upgrade --backlog --force reaches the guard through the CLI", async () => {
  const { root, child } = await initializedParentManagedChild();
  try {
    await stripLockEntries(child);
    const refused = await runSpecnaut(["upgrade", "--backlog", "github"], { cwd: child });
    assert(
      refused.code !== 0,
      `the CLI must refuse without --force, got exit 0:\n${refused.stdout}`,
    );
    const forced = await runSpecnaut(
      ["upgrade", "--backlog", "github", "--force"],
      { cwd: child },
    );
    assertEquals(forced.code, 0, `--force must reach the guard: ${forced.stderr}`);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
