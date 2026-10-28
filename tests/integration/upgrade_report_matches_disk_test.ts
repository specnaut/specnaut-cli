import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { walk } from "@std/fs/walk";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * #519 — the upgrade report described the plan and called it the outcome.
 *
 * Three defects, one root: `renderSummary` was handed the pre-write plan and
 * never learned what the run had written. Under `--force` that made it state
 * the opposite of the truth twice over — every overwritten file was listed as
 * "customized locally (not touched)", and the files that had just received a
 * long-delayed update were the ones warned to have missed it permanently.
 *
 * The third defect is `--reset-baseline`: it re-baselined the entire
 * `customized` bucket rather than the "behind" list its own hint advertises,
 * and wrote none of the `.specnaut.bak` copies that hint promises.
 */

async function specnaut(args: string[], cwd: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "-A", MAIN, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    out: new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr),
  };
}

async function sandbox(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-519-" });
  await new Deno.Command("git", { args: ["init", "-q", "."], cwd: dir }).output();
  await Deno.writeTextFile(join(dir, "package.json"), "{}");
  const r = await specnaut(["init", "--here", "--ai", "claude", "--backlog", "local"], dir);
  assert(r.code === 0, `init failed:\n${r.out}`);
  return dir;
}

/**
 * Put one tracked file into the "behind" state: diverged from its baseline, and
 * upstream moved after it was written. Mirrors the helper in
 * tests/cli/handlers/upgrade_stale_report_test.ts.
 */
async function freezeBehind(dir: string): Promise<string> {
  const lockPath = join(dir, ".specnaut", "installed.lock");
  const lock = await Deno.readTextFile(lockPath);
  const target = [...lock.matchAll(/^ {2}(\.claude\/agents\/[^\s:]+\.md):$/gm)]
    .map((m) => m[1])[0];
  assert(target, "expected the lock to track at least one agent file");

  const file = join(dir, target);
  await Deno.writeTextFile(file, (await Deno.readTextFile(file)) + "\n<!-- local note -->\n");

  const block = new RegExp(
    `(^ {2}${target.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}:\\n    sha256: )([0-9a-f]+)` +
      `(\\n    installed_at: '[^']+'\\n    templates_version: )(\\S+)`,
    "m",
  );
  assert(block.test(lock), `could not locate the lock entry for ${target}`);
  await Deno.writeTextFile(
    lockPath,
    lock.replace(block, (_m, head, _sha, mid) => `${head}${"f".repeat(64)}${mid}1.12.0`),
  );
  return target;
}

/** Mark every managed markdown file as customized, the way a formatter would. */
async function customizeAll(dir: string, marker: string): Promise<string[]> {
  const touched: string[] = [];
  // Not through links: `.claude/CLAUDE.md` is a link to the user's own
  // AGENTS.md (cli#680), and writing through it edits a file upgrade never owns.
  const opts = { includeDirs: false, includeSymlinks: false, exts: [".md"] };
  for await (const e of walk(join(dir, ".claude"), opts)) {
    await Deno.writeTextFile(e.path, (await Deno.readTextFile(e.path)) + `\n${marker}\n`);
    touched.push(e.path);
  }
  assert(touched.length > 0, "expected .claude to hold managed markdown");
  return touched;
}

async function countBaks(dir: string): Promise<number> {
  let n = 0;
  for await (const e of walk(dir, { includeDirs: false })) {
    if (e.path.endsWith(".specnaut.bak")) n++;
  }
  return n;
}

Deno.test("--force does not warn about updates it just delivered", async () => {
  const dir = await sandbox();
  try {
    const target = await freezeBehind(dir);
    const { out } = await specnaut(["upgrade", "--force"], dir);

    // The file did receive the update — that is what makes the old warning wrong.
    const after = await Deno.readTextFile(join(dir, target));
    assert(!after.includes("<!-- local note -->"), "expected --force to overwrite the file");

    assertStringIncludes(out, "✓ upgraded to templates");
    assert(
      !out.includes("did not receive"),
      `--force delivered ${target} and must not warn that it was missed:\n${out}`,
    );
    assert(
      !out.includes("Nothing will deliver"),
      `a delivered file must not be described as undeliverable:\n${out}`,
    );
    // ...and it is reported as what it is.
    assertStringIncludes(out, "overwritten (was customized");
    assertStringIncludes(out, target);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("--force does not report overwritten files as 'not touched'", async () => {
  const dir = await sandbox();
  try {
    const marked = await customizeAll(dir, "<!-- MINE -->");
    const { out } = await specnaut(["upgrade", "--force"], dir);

    let survived = 0;
    for (const p of marked) {
      if ((await Deno.readTextFile(p)).includes("<!-- MINE -->")) survived++;
    }
    assertEquals(survived, 0, "--force is expected to overwrite every customized file");

    assert(
      !out.includes("customized locally (not touched)"),
      `every customized file was overwritten; nothing was left untouched:\n${out}`,
    );
    assertStringIncludes(out, `${marked.length} overwritten`);
    assertStringIncludes(out, "0 preserved");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a dry run still reports the forecast, warning included", async () => {
  const dir = await sandbox();
  try {
    const target = await freezeBehind(dir);
    const { out } = await specnaut(["upgrade", "--dry-run"], dir);

    // Nothing was written, so the plan IS the outcome and the report must keep
    // saying so — the #519 fix narrows the claim, it does not silence it.
    assertStringIncludes(out, "customized, and behind");
    assertStringIncludes(out, target);
    assert(!out.includes("overwritten (was customized"), out);
    const still = await Deno.readTextFile(join(dir, target));
    assertStringIncludes(still, "<!-- local note -->");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("--reset-baseline resets only the files upstream moved for", async () => {
  const dir = await sandbox();
  try {
    const target = await freezeBehind(dir);
    const marked = (await customizeAll(dir, "<!-- MINE -->"))
      .filter((p) => p !== join(dir, target));

    const { out } = await specnaut(["upgrade", "--reset-baseline"], dir);

    // The behind file is what the flag exists for.
    const behind = await Deno.readTextFile(join(dir, target));
    assert(
      !behind.includes("<!-- local note -->"),
      `expected ${target} to be re-baselined:\n${out}`,
    );

    // Everything else was merely customized: no update was waiting for it, and
    // the flag has no business rewriting it.
    let survived = 0;
    for (const p of marked) {
      if ((await Deno.readTextFile(p)).includes("<!-- MINE -->")) survived++;
    }
    assertEquals(
      survived,
      marked.length,
      `--reset-baseline must not touch settled customized files:\n${out}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("--reset-baseline writes the .specnaut.bak its hint promises", async () => {
  const dir = await sandbox();
  try {
    const target = await freezeBehind(dir);

    const dry = await specnaut(["upgrade", "--dry-run"], dir);
    assertStringIncludes(dry.out, "keeps a .specnaut.bak of each");
    assertEquals(await countBaks(dir), 0);

    await specnaut(["upgrade", "--reset-baseline"], dir);

    assertEquals(
      await countBaks(dir),
      1,
      "the overwritten file's previous content must survive as a .specnaut.bak",
    );
    const bak = await Deno.readTextFile(join(dir, `${target}.specnaut.bak`));
    assertStringIncludes(bak, "<!-- local note -->");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
