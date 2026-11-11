import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * `specnaut upgrade` shows what is new in every release it crossed (cli#759),
 * through the real command and the history this binary embeds.
 *
 * The assertions are sentences from the releases' PUBLISHED highlights — the
 * `### Highlights` section of the v9.1.0 and v9.2.0 GitHub release bodies,
 * recorded under `tests/fixtures/release_highlights/`. A sentence that exists
 * in one release only can be printed by nothing but that release's entry, so
 * a range off by one, a lost entry or a block printed on the wrong branch each
 * turns one of them red.
 */

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));
const FIXTURES = new URL("../fixtures/release_highlights/", import.meta.url);
const HISTORY = new URL("../../.specnaut/release/history/", import.meta.url);

const ONLY_IN = {
  "9.1.0": "**The approval hooks are gone.**",
  "9.2.0": "**`specnaut scan` maps a repository without a model.**",
} as const;

const published = (v: string) => Deno.readTextFile(new URL(`v${v}.md`, FIXTURES));
const link = (v: string) => `https://github.com/specnaut/specnaut-cli/releases/tag/v${v}`;

async function specnaut(args: string[], cwd: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code, out: new TextDecoder().decode(stdout), err: new TextDecoder().decode(stderr) };
}

/** A project initialised by this binary, its lock then set back to `version`. */
async function projectAt(version: string | null): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-notes-" });
  const init = await specnaut(["init", "--here", "--no-git", "--backlog", "local"], dir);
  assertEquals(init.code, 0, init.err);
  if (version !== null) {
    const lockPath = join(dir, ".specnaut", "installed.lock");
    const lock = await Deno.readTextFile(lockPath);
    const header = /^templates_version: .*$/m;
    assert(header.test(lock), "the lock records its templates version at the top level");
    await Deno.writeTextFile(lockPath, lock.replace(header, `templates_version: ${version}`));
  }
  return dir;
}

Deno.test("the sentences asserted below exist in one published release only", async () => {
  assertStringIncludes(await published("9.1.0"), ONLY_IN["9.1.0"]);
  assertStringIncludes(await published("9.2.0"), ONLY_IN["9.2.0"]);
  assert(!(await published("9.2.0")).includes(ONLY_IN["9.1.0"]));
  assert(!(await published("9.1.0")).includes(ONLY_IN["9.2.0"]));
});

Deno.test("each backfilled history file is the highlights its release published", async () => {
  for (const v of ["9.1.0", "9.2.0"]) {
    const history = await Deno.readTextFile(new URL(`v${v}.md`, HISTORY));
    assertEquals(history.trim(), (await published(v)).trim(), `v${v}`);
  }
});

Deno.test("an upgrade from 9.0.0 shows 9.1.0 then 9.2.0, each with its link (SC-001)", async () => {
  const dir = await projectAt("9.0.0");
  try {
    // A file to restore, so the run takes the applied branch.
    await Deno.remove(join(dir, ".specnaut", "memory", "size-limits.md"));
    const { code, out, err } = await specnaut(["upgrade"], dir);
    assertEquals(code, 0, err);
    assertStringIncludes(out, "upgraded to templates 9.0.0 →");
    const at = (s: string) => out.indexOf(s);
    for (const v of ["9.1.0", "9.2.0"] as const) {
      assertStringIncludes(out, ONLY_IN[v]);
      assertStringIncludes(out, link(v));
    }
    assert(at(ONLY_IN["9.1.0"]) < at(link("9.1.0")), "a release's link follows its highlights");
    assert(at(link("9.1.0")) < at(ONLY_IN["9.2.0"]), "9.1.0 comes before 9.2.0");
    assert(!out.includes(link("9.0.0")), "the starting release is not crossed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a crossing that moved only the version shows its notes (S4, SC-002)", async () => {
  const dir = await projectAt("9.1.0");
  try {
    const { code, out, err } = await specnaut(["upgrade"], dir);
    assertEquals(code, 0, err);
    assertStringIncludes(out, "already up to date");
    assertStringIncludes(out, ONLY_IN["9.2.0"]);
    assertStringIncludes(out, link("9.2.0"));
    assert(!out.includes(ONLY_IN["9.1.0"]), "9.1.0 was the starting point, not a crossing");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an upgrade with no version change says so and shows nothing (S2, SC-002)", async () => {
  const dir = await projectAt(null);
  try {
    const { code, out, err } = await specnaut(["upgrade"], dir);
    assertEquals(code, 0, err);
    assertStringIncludes(out, "already up to date");
    assertStringIncludes(out, "No version change — no release notes to show.");
    assert(!out.includes("Full notes:"), out);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a dry run prints no release notes", async () => {
  const dir = await projectAt("9.0.0");
  try {
    await Deno.remove(join(dir, ".specnaut", "memory", "size-limits.md"));
    const { code, out, err } = await specnaut(["upgrade", "--dry-run"], dir);
    assertEquals(code, 0, err);
    assert(!out.includes("Full notes:"), out);
    assert(!out.includes("No version change"), out);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
