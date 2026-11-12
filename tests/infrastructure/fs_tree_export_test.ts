import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { ExportRefused } from "../../src/application/untrusted_review_ports.ts";
import type { ExportPlan } from "../../src/domain/tree_plan.ts";
import { exportCacheRoot, FsExportStore } from "../../src/infrastructure/fs_tree_export.ts";
import { GitTreeObjects } from "../../src/infrastructure/git_tree_objects.ts";
import { blob, commit, git, initRepo, tempDir, tree } from "../helpers/git_fixture.ts";

const env = (vars: Record<string, string>) => (name: string) => vars[name];
const posix = Deno.build.os !== "windows";
const exists = (p: string) => Deno.lstat(p).then(() => true, () => false);

Deno.test("the export lives in the user's cache folder, as each platform names it", () => {
  const tail = join("specnaut", "untrusted");
  assertEquals(
    exportCacheRoot("linux", env({ XDG_CACHE_HOME: "/x/c", HOME: "/h" })),
    join("/x/c", tail),
  );
  assertEquals(exportCacheRoot("linux", env({ HOME: "/h" })), join("/h", ".cache", tail));
  assertEquals(
    exportCacheRoot("darwin", env({ HOME: "/h" })),
    join("/h", "Library", "Caches", tail),
  );
  assertEquals(
    exportCacheRoot("linux", env({ XDG_CACHE_HOME: "rel", HOME: "/h" })),
    join("/h", ".cache", tail),
  );
  assertThrows(() => exportCacheRoot("linux", env({})), ExportRefused, "no cache folder");
});

type Fixture = { base: string; store: FsExportStore; plan: ExportPlan; head: string };

/** A store that has staged, claimed and written a two-file plan from a real repository. */
async function written(): Promise<Fixture> {
  const base = await tempDir("store-");
  for (const d of ["repo", "project"]) await Deno.mkdir(join(base, d));
  const repo = await initRepo(join(base, "repo"));
  const a = await blob(repo, "alpha\n");
  const b = await blob(repo, "beta\n");
  const head = await commit(repo, await tree(repo, [["100644", "a", a], ["100755", "b", b]]));
  const store = new FsExportStore(join(base, "project"), join(base, "cache"));
  const staged = await store.stage();
  await git(repo, ["clone", "-q", "--bare", "--template=", repo, staged]);
  const plan: ExportPlan = {
    files: [
      { path: "a", names: ["a"], sha: a, executable: false },
      { path: "d/b", names: ["d", "b"], sha: b, executable: true },
    ],
    listed: [],
  };
  const home = await store.claim(head, staged);
  await store.write(plan, new GitTreeObjects(home.gitDir));
  return { base, store, plan, head };
}

async function withWritten(fn: (f: Fixture, seats: string) => Promise<void>): Promise<void> {
  const f = await written();
  try {
    await fn(f, join(f.base, "cache", f.head, "seats"));
  } finally {
    await f.store.remove();
    await Deno.remove(f.base, { recursive: true });
  }
}

Deno.test("a copy as written passes the re-hash", async () => {
  await withWritten((f) => f.store.verify(f.plan));
});

Deno.test("the re-hash refuses a changed file", async () => {
  await withWritten(async (f, seats) => {
    await Deno.writeTextFile(join(seats, "a"), "changed\n");
    await assertRejects(() => f.store.verify(f.plan), ExportRefused, "differs from the commit");
  });
});

Deno.test("the re-hash refuses a file the export did not write", async () => {
  await withWritten(async (f, seats) => {
    await Deno.writeTextFile(join(seats, "extra"), "x");
    await assertRejects(() => f.store.verify(f.plan), ExportRefused, "not written by the export");
  });
});

Deno.test("the re-hash refuses a missing file", async () => {
  await withWritten(async (f, seats) => {
    await Deno.remove(join(seats, "a"));
    await assertRejects(() => f.store.verify(f.plan), ExportRefused, "missing");
  });
});

Deno.test({
  name: "the re-hash refuses a link and a file that is not 0644",
  ignore: !posix,
  fn: async () => {
    await withWritten(async (f, seats) => {
      await Deno.chmod(join(seats, "d", "b"), 0o755);
      await assertRejects(() => f.store.verify(f.plan), ExportRefused, "not mode 0644");
      await Deno.chmod(join(seats, "d", "b"), 0o644);
      await Deno.symlink("/etc/hosts", join(seats, "d", "c"));
      await assertRejects(() => f.store.verify(f.plan), ExportRefused, "is a link");
    });
  },
});

Deno.test("a file is never written over: writing a top-level file twice is refused", async () => {
  await withWritten(async (f) => {
    // Top level, so no folder is made on the way and the refusal is the file's own create.
    const once: ExportPlan = { files: [f.plan.files[0]], listed: [] };
    const objects = new GitTreeObjects(join(f.base, "cache", f.head, "git"));
    await assertRejects(() => f.store.write(once, objects), Deno.errors.AlreadyExists);
  });
});

Deno.test("a cache folder inside the project is refused", async () => {
  const base = await tempDir("store-");
  try {
    const store = new FsExportStore(base, join(base, "cache"));
    await assertRejects(() => store.stage(), ExportRefused, "inside the project");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("a folder left at the commit's name is replaced, not reused", async () => {
  const base = await tempDir("store-");
  try {
    await Deno.mkdir(join(base, "project"));
    const store = new FsExportStore(join(base, "project"), join(base, "cache"));
    const staged = await store.stage();
    await Deno.mkdir(staged);
    const sha = "c".repeat(40);
    await Deno.mkdir(join(base, "cache", sha, "seats"), { recursive: true });
    await Deno.writeTextFile(join(base, "cache", sha, "seats", "planted"), "x");
    const home = await store.claim(sha, staged);
    assertEquals(await exists(join(home.seats, "planted")), false);
    assertEquals(await exists(join(base, "cache", sha, "git")), true);
    await store.remove();
    assertEquals([...Deno.readDirSync(join(base, "cache"))], []);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("claim refuses an id that is not a full commit id, before it names a path", async () => {
  const base = await tempDir("store-");
  try {
    await Deno.mkdir(join(base, "project"));
    const store = new FsExportStore(join(base, "project"), join(base, "cache"));
    const staged = await store.stage();
    await assertRejects(() => store.claim("../x", staged), ExportRefused, "full commit id");
    await store.remove();
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

const PROBE = fromFileUrl(new URL("./fs_tree_export_trap_probe.ts", import.meta.url));

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

/** Runs the probe, which stages an export and then ends as `how` says; returns what it staged. */
async function probe(base: string, how: "exit" | "return" | "signal"): Promise<string> {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-write", "--allow-env", PROBE, base, how],
    cwd: ROOT,
    stdout: "piped",
    stderr: "inherit",
  }).spawn();
  const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  while (!text.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += value;
  }
  if (how === "signal") child.kill("SIGTERM");
  await reader.cancel();
  const status = await child.status;
  if (how === "signal") assertEquals(status.code, 143);
  return text.trim();
}

for (const how of ["exit", "return", "signal"] as const) {
  Deno.test({
    name: `the exit trap removes a staged export when the process ends (${how})`,
    ignore: how === "signal" && !posix,
    fn: async () => {
      const base = await tempDir("trap-");
      try {
        const staged = await probe(base, how);
        assertEquals(staged.startsWith(join(base, "cache", ".fetch-")), true, staged);
        assertEquals(await exists(dirname(staged)), false, `${staged} survived the process`);
        assertEquals(await exists(join(base, "cache")), true, "the probe never staged");
      } finally {
        await Deno.remove(base, { recursive: true });
      }
    },
  });
}
