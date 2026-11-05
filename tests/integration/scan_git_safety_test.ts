import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { git, gitWithInput, lines, POSIX, repo, scan, scanJson, write } from "./scan_fixture.ts";

/**
 * How the scan meets an unvetted repository (plan S1, S3, S7): git runs no program the
 * repository names, a `git` planted in the working folder is never the one run, and a path is
 * opened only when the disk says it is a regular file under real folders, whatever the index says.
 */

/** Whether `path` exists. Only "not found" means no: any other error is the test's own failure. */
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function plantMarkerScript(path: string, marker: string): Promise<void> {
  const windows = path.endsWith(".cmd") || path.endsWith(".bat");
  await Deno.writeTextFile(
    path,
    windows ? `@echo ran> "${marker}"\r\n` : `#!/bin/sh\necho ran > '${marker}'\n`,
  );
  if (!windows) await Deno.chmod(path, 0o755);
}

Deno.test({
  name: "core.fsmonitor names a program: plain git runs it, the scan's git does not (S1)",
  ignore: !POSIX,
  fn: async () => {
    const dir = await repo({ "a.ts": lines(1) });
    const marker = join(await Deno.makeTempDir({ prefix: "scan-marker-" }), "fsmonitor-ran");
    const hook = join(await Deno.makeTempDir({ prefix: "scan-hook-" }), "monitor.sh");
    await plantMarkerScript(hook, marker);
    await git(dir, "config", "core.fsmonitor", hook);
    // git may fail once the hook exits oddly; the hook having run is what counts, so the error
    // is kept for the message rather than thrown.
    const probe = await git(dir, "ls-files").then(() => "git succeeded", String);
    assertEquals(
      await exists(marker),
      true,
      `the fixture's hook must be live, or this proves nothing (${probe})`,
    );
    await Deno.remove(marker);
    const { result, json } = await scanJson(dir);
    assertEquals([result.code, json.totals.tracked], [0, 1], result.stderr);
    assertEquals(await exists(marker), false, "the scan's git ran the repository's fsmonitor");
  },
});

Deno.test("a git planted in the working folder is never the one the scan runs (S7)", async () => {
  const dir = await repo({ "a.ts": lines(1) });
  const marker = join(await Deno.makeTempDir({ prefix: "scan-marker-" }), "planted-ran");
  const plants = POSIX ? ["git"] : ["git.cmd", "git.bat"];
  for (const name of plants) await plantMarkerScript(join(dir, name), marker);
  // A real executable named git.exe: had it run, git's answers would be missing and the scan exit 3.
  if (!POSIX) await Deno.copyFile(Deno.execPath(), join(dir, "git.exe"));
  const live = POSIX ? ["sh", ["./git"]] as const : ["cmd", ["/c", "git.cmd"]] as const;
  await new Deno.Command(live[0], { args: [...live[1]], cwd: dir }).output();
  assertEquals(
    await exists(marker),
    true,
    "the planted script must be live, or this proves nothing",
  );
  await Deno.remove(marker);
  const { result, json } = await scanJson(dir);
  assertEquals([result.code, json.totals.tracked], [0, 1], result.stderr);
  assertEquals(await exists(marker), false, "the scan ran a git planted in its working folder");
});

/**
 * A repository whose index holds four regular files, while on disk `a/` is a link to a folder
 * outside, `b.ts` a link to a file outside and `c.ts` a FIFO; only `d.ts` is what the index says.
 */
async function diskUnlikeTheIndex(): Promise<string> {
  const outside = await Deno.makeTempDir({ prefix: "scan-outside-" });
  await write(outside, { "x.ts": lines(7000), "secret.ts": lines(9000) });
  const dir = await repo({
    "a/x.ts": lines(1),
    "b.ts": lines(1),
    "c.ts": lines(1),
    "d.ts": lines(2),
  });
  await Deno.remove(join(dir, "a"), { recursive: true });
  await Deno.symlink(outside, join(dir, "a"));
  await Deno.remove(join(dir, "b.ts"));
  await Deno.symlink(join(outside, "secret.ts"), join(dir, "b.ts"));
  await Deno.remove(join(dir, "c.ts"));
  await new Deno.Command("mkfifo", { args: [join(dir, "c.ts")] }).output();
  return dir;
}

Deno.test({
  name:
    "the disk decides, not the index: a link above, a link at, or a FIFO at a path is never opened",
  ignore: !POSIX,
  fn: async () => {
    const { result, json } = await scanJson(await diskUnlikeTheIndex());
    assertEquals(result.code, 0, result.stderr);
    const s = json.totals.skipped_by;
    assertEquals([s.link_ancestor, s.symlink, s.not_regular], [1, 1, 1]);
    assertEquals(
      [json.totals.measured, json.totals.lines],
      [1, 2],
      "a line was read through a link",
    );
  },
});

Deno.test({
  name: "the index's own links and submodules are skipped, never followed",
  ignore: !POSIX,
  fn: async () => {
    const dir = await repo({ "real.ts": lines(3) });
    await Deno.symlink("real.ts", join(dir, "link.ts"));
    await git(dir, "add", "link.ts");
    const sha = (await git(dir, "rev-parse", "HEAD")).trim();
    await git(dir, "update-index", "--add", "--cacheinfo", `160000,${sha},vendored`);
    const { json } = await scanJson(dir);
    assertEquals([json.totals.skipped_by.symlink, json.totals.skipped_by.submodule], [1, 1]);
    assertEquals(json.totals.lines, 3);
  },
});

Deno.test("a tracked name that is not UTF-8 is skipped with its reason, never reported missing", async () => {
  const dir = await repo({ "ok.ts": lines(1) });
  const blob = (await git(dir, "hash-object", "-w", "ok.ts")).trim();
  const name = [0x62, 0xff, 0x2e, 0x74, 0x73]; // "b\xff.ts"
  const record = new Uint8Array([...new TextEncoder().encode(`100644 ${blob}\t`), ...name, 0]);
  await gitWithInput(dir, record, "update-index", "-z", "--index-info");
  const { json } = await scanJson(dir);
  assertEquals(
    [json.totals.tracked, json.totals.skipped_by.undecodable_name, json.totals.missing],
    [2, 1, 0],
  );
});

Deno.test("a conflicted path, listed once per stage by git, is measured once", async () => {
  const dir = await repo({ "c.ts": "base\n" });
  const first = (await git(dir, "branch", "--show-current")).trim();
  await git(dir, "switch", "-q", "-c", "other");
  await write(dir, { "c.ts": "other\n" });
  await git(dir, "commit", "-q", "-am", "other");
  await git(dir, "switch", "-q", first);
  await write(dir, { "c.ts": "main\n" });
  await git(dir, "commit", "-q", "-am", "main");
  await assertRejects(() => git(dir, "merge", "-q", "other"));
  assertEquals((await git(dir, "ls-files", "--stage")).trim().split("\n").length, 3);
  const { json } = await scanJson(dir);
  assertEquals([json.totals.tracked, json.totals.measured], [1, 1]);
});

Deno.test({
  name: "--path reaches git as a literal pathspec after --, so no magic and no option",
  ignore: !POSIX, // `:` is not a file name character on Windows
  fn: async () => {
    const dir = await repo({ ":(top)x/a.ts": lines(1), "x/b.ts": lines(1) });
    const { json } = await scanJson(dir, "--path", ":(top)x");
    const folders = json.folders_by_files.items.map((f: { path: string }) => f.path);
    assertEquals([json.totals.tracked, folders], [1, [":(top)x"]], "magic read x/, not :(top)x/");
    assertEquals((await scan(dir, "--path", "--all")).code, 2);
  },
});
