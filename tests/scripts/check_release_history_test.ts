import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

/**
 * A history record is never edited after its release (cli#775). The release
 * gate compares only the record of the tag being cut, so this check, run in
 * CI, compares every record whose tag exists with `HIGHLIGHTS.md` as that tag
 * published it: whitespace-insensitive, a missing file read as empty.
 */

const SCRIPT = fromFileUrl(new URL("../../scripts/check-release-history.ts", import.meta.url));
const H = ".specnaut/release/HIGHLIGHTS.md";
const HISTORY = ".specnaut/release/history";
const LEAD = "**A thing shipped.**\n\nIt does the thing, and here is why.\n";

async function git(cwd: string, ...args: string[]) {
  const out = await new Deno.Command("git", { args, cwd, stdout: "null", stderr: "piped" })
    .output();
  assert(out.success, `git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr)}`);
}

async function run(cwd: string): Promise<{ code: number; err: string }> {
  const out = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-run", SCRIPT],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code: out.code, err: new TextDecoder().decode(out.stderr) };
}

/** A repo whose `v1.0.0` tag published `published` (`null`: no highlights file) and recorded `record`. */
async function released(
  published: string | null,
  record: string,
): Promise<AsyncDisposable & { dir: string }> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-history-check-" });
  const repo = { dir, [Symbol.asyncDispose]: () => Deno.remove(dir, { recursive: true }) };
  await git(dir, "init", "-q");
  await git(dir, "config", "user.email", "t@t");
  await git(dir, "config", "user.name", "t");
  await Deno.mkdir(join(dir, HISTORY), { recursive: true });
  if (published !== null) await Deno.writeTextFile(join(dir, H), published);
  await Deno.writeTextFile(join(dir, HISTORY, "v1.0.0.md"), record);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "chore: release v1.0.0");
  await git(dir, "tag", "-a", "v1.0.0", "-m", "v1.0.0");
  return repo;
}

/** Rewrites a file in the repo and commits it after the tag. */
async function edit(dir: string, file: string, text: string) {
  await Deno.mkdir(join(dir, file, ".."), { recursive: true });
  await Deno.writeTextFile(join(dir, file), text);
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "docs: later edit");
}

Deno.test("a record equal to what its tag published passes, reflowed or not", async () => {
  await using repo = await released(LEAD, LEAD);
  assertEquals((await run(repo.dir)).code, 0);
  await edit(repo.dir, `${HISTORY}/v1.0.0.md`, LEAD.replace(", and", ",\nand"));
  assertEquals((await run(repo.dir)).code, 0);
});

Deno.test("a record edited after its release is refused, naming it and its tag", async () => {
  await using repo = await released(LEAD, LEAD);
  await edit(repo.dir, `${HISTORY}/v1.0.0.md`, "**Rewritten after the fact.**\n");
  const { code, err } = await run(repo.dir);
  assertEquals(code, 1);
  assert(err.includes(`${HISTORY}/v1.0.0.md`), err);
  assert(err.includes("v1.0.0"), err);
});

Deno.test("HIGHLIGHTS.md rewritten for the next release leaves a past record alone", async () => {
  await using repo = await released(LEAD, LEAD);
  await edit(repo.dir, H, "**The next lead.**\n");
  assertEquals((await run(repo.dir)).code, 0);
});

Deno.test("a record whose tag does not exist yet is not compared", async () => {
  // The release commit lands before its tag is cut.
  await using repo = await released(LEAD, LEAD);
  await edit(repo.dir, `${HISTORY}/v1.1.0.md`, "**Not tagged yet.**\n");
  assertEquals((await run(repo.dir)).code, 0);
});

Deno.test("a tag that published no highlights file reads as empty", async () => {
  await using empty = await released(null, "");
  assertEquals((await run(empty.dir)).code, 0);
  await using claimed = await released(null, "**Highlights it never published.**\n");
  const { code, err } = await run(claimed.dir);
  assertEquals(code, 1);
  assert(err.includes(`${HISTORY}/v1.0.0.md`), err);
});

Deno.test("records with no tag visible are refused, never passed on nothing", async () => {
  // A shallow CI checkout fetches no tag: without this the check compares nothing and passes.
  await using repo = await released(LEAD, "**Edited.**\n");
  await git(repo.dir, "tag", "-d", "v1.0.0");
  const { code, err } = await run(repo.dir);
  assertEquals(code, 1);
  assert(err.includes("no v* tag"), err);
});

Deno.test("CI fetches the tags, then runs this check on every push", async () => {
  // The checkout is shallow and tagless: a step that ran the check alone would
  // fail on the no-tag guard, and one that skipped it would check nothing.
  type Workflow = { jobs: Record<string, { steps?: Array<{ run?: string }> }> };
  const ci = parse(
    await Deno.readTextFile(
      fromFileUrl(new URL("../../.github/workflows/ci.yml", import.meta.url)),
    ),
  ) as Workflow;
  const runs = Object.values(ci.jobs).flatMap((j) => j.steps ?? []).map((s) => s.run ?? "");
  const step = runs.find((r) => r.includes("scripts/check-release-history.ts"));
  assert(step !== undefined, "ci.yml runs no step calling scripts/check-release-history.ts");
  const fetch = step.indexOf("refs/tags/v*");
  assert(fetch !== -1 && fetch < step.indexOf("scripts/check-release-history.ts"), step);
});
