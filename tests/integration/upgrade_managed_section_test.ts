import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * #466 — the two-stop section must reach projects that UPGRADE, not only
 * projects that init fresh.
 *
 * `AGENTS.md` is `skipIfExists`: the user owns it, it accumulates working
 * agreements no template can reconstruct, and an upgrade must never rewrite it.
 * That default is correct and is not being flipped here. But it left the rule
 * arriving only at fresh init — i.e. everywhere except the projects already
 * running the chain, which are precisely the ones that stall.
 *
 * The mechanism: one fenced, Specnaut-owned section grafted into whatever the
 * user has. These tests pin the two properties that make that safe — every line
 * the user wrote survives byte-identical, and a second run changes nothing.
 */

const START = "<!-- --- Specnaut: chain-stops --- -->";
const END = "<!-- --- End Specnaut: chain-stops --- -->";
const HEADING = "## The Specnaut chain runs on autopilot after the plan";

/**
 * #576 added a SECOND label on the same destination. Every assertion above this
 * line names `chain-stops` literally, so all of them stayed green when
 * `managedSectionEntries` was reduced to one label — and the label silently
 * dropped was `ui-defaults`, the whole of #576. A per-label test is not enough
 * either: what has to be pinned is that the count grafted equals the count
 * declared, so the next third label is covered by this test on the day it is
 * added rather than the day someone notices.
 */
const UI_START = "<!-- --- Specnaut: ui-defaults --- -->";
const UI_END = "<!-- --- End Specnaut: ui-defaults --- -->";

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

const INIT = ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"];

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-managed-section-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("upgrade delivers the section into an AGENTS.md that predates Specnaut", async () => {
  await withTempDir(async (dir) => {
    // The brownfield case: the user already had an AGENTS.md when they ran
    // init, so init skipped it AND left it out of the lock. Nothing in the
    // plan has ever had a reason to touch this file.
    const own = "# AGENTS.md\n\n## House rules\n\nWe rebase, never merge commits.\n";
    const agents = join(dir, "AGENTS.md");
    await Deno.writeTextFile(agents, own);

    const init = await runSpecnaut(INIT, dir);
    assertEquals(init.code, 0, `init failed: ${init.stderr}`);
    assertEquals(await Deno.readTextFile(agents), own, "init must not touch a pre-existing file");

    const up = await runSpecnaut(["upgrade"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

    const after = await Deno.readTextFile(agents);
    assert(
      after.startsWith(own.trimEnd()),
      "the user's own content must survive as the exact prefix, unreordered",
    );
    assertStringIncludes(after, START);
    assertStringIncludes(after, END);
    assertStringIncludes(after, HEADING);
    assertStringIncludes(after, "only under `merge: manual`");
    // ...and the run says so out loud, so a section appearing in an
    // always-loaded file is never mistaken for an overwrite.
    assertStringIncludes(up.stdout, "AGENTS.md");
    assertStringIncludes(up.stdout, "chain-stops");
  });
});

Deno.test("a second upgrade does not duplicate the section", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "AGENTS.md"), "# AGENTS.md\n\nOurs.\n");
    assertEquals((await runSpecnaut(INIT, dir)).code, 0);
    assertEquals((await runSpecnaut(["upgrade"], dir)).code, 0);
    const once = await Deno.readTextFile(join(dir, "AGENTS.md"));

    const second = await runSpecnaut(["upgrade"], dir);
    assertEquals(second.code, 0, `second upgrade failed: ${second.stderr}`);
    const twice = await Deno.readTextFile(join(dir, "AGENTS.md"));

    assertEquals(twice, once, "a no-op upgrade must leave the file byte-identical");
    assertEquals(occurrences(twice, START), 1);
    assertEquals(occurrences(twice, HEADING), 1);
    // Nothing changed, so nothing is announced.
    assert(
      !second.stdout.includes("chain-stops"),
      "an unchanged section must not be reported as delivered",
    );
  });
});

Deno.test("upgrade restores a gutted section without disturbing the user's edits", async () => {
  await withTempDir(async (dir) => {
    assertEquals((await runSpecnaut(INIT, dir)).code, 0);
    const agents = join(dir, "AGENTS.md");
    const scaffolded = await Deno.readTextFile(agents);

    // The user trims the managed section down to nothing and adds a section of
    // their own after it. Both edits are honest uses of a file they own.
    const startIdx = scaffolded.indexOf(START);
    const endIdx = scaffolded.indexOf(END) + END.length;
    assert(startIdx !== -1 && endIdx > startIdx, "the scaffolded file must carry the fences");
    const gutted = scaffolded.slice(0, startIdx) +
      `${START}\n\ngutted by hand\n\n${END}` +
      scaffolded.slice(endIdx) +
      "\n## Our own rules\n\nDeploy on Fridays.\n";
    await Deno.writeTextFile(agents, gutted);

    const up = await runSpecnaut(["upgrade"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

    const after = await Deno.readTextFile(agents);
    assertStringIncludes(after, HEADING);
    assert(!after.includes("gutted by hand"), "the managed body must be replaced, not stacked");
    assertStringIncludes(after, "Deploy on Fridays.");
    assertEquals(occurrences(after, START), 1);
  });
});

Deno.test("a dry-run reports the section without writing it", async () => {
  await withTempDir(async (dir) => {
    const own = "# AGENTS.md\n\nOurs.\n";
    const agents = join(dir, "AGENTS.md");
    await Deno.writeTextFile(agents, own);
    assertEquals((await runSpecnaut(INIT, dir)).code, 0);

    const dry = await runSpecnaut(["upgrade", "--dry-run"], dir);
    assertEquals(dry.code, 0, `dry-run failed: ${dry.stderr}`);
    assertStringIncludes(dry.stdout, "chain-stops");
    assertEquals(await Deno.readTextFile(agents), own, "--dry-run must write nothing");
  });
});

Deno.test("upgrade grafts EVERY declared section, not just the first", async () => {
  await withTempDir(async (dir) => {
    const own = "# AGENTS.md\n\n## House rules\n\nWe rebase, never merge commits.\n";
    const agents = join(dir, "AGENTS.md");
    await Deno.writeTextFile(agents, own);

    assertEquals((await runSpecnaut(INIT, dir)).code, 0);
    const up = await runSpecnaut(["upgrade"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

    const after = await Deno.readTextFile(agents);

    // Derived from the manifest, not hand-listed: a third label added tomorrow
    // is asserted by this test the same day, without anyone editing it.
    const manifest = JSON.parse(
      await Deno.readTextFile(
        fromFileUrl(new URL("../../templates/manifest.json", import.meta.url)),
      ),
    ) as { core: Array<{ category: string; suffix?: string; managedSection?: string | string[] }> };
    const entry = manifest.core.find((e) =>
      e.category === "project-root" && e.suffix === "AGENTS.md"
    );
    assert(entry, "no project-root AGENTS.md manifest entry");
    const declared = typeof entry!.managedSection === "string"
      ? [entry!.managedSection]
      : [...(entry!.managedSection ?? [])];
    assert(declared.length > 1, "this test is pointless with one label — it must have several");

    const missing = declared.filter((label) =>
      !after.includes(`<!-- --- Specnaut: ${label} --- -->`)
    );
    assertEquals(missing, [], "declared managed sections that never reached the user's file");

    // And the user's own content still leads, unreordered.
    assert(after.startsWith(own.trimEnd()), "the user's content must survive as the exact prefix");
  });
});

Deno.test("the ui-defaults graft carries the pointer, not just its fences", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "AGENTS.md"), "# AGENTS.md\n\nOurs.\n");
    assertEquals((await runSpecnaut(INIT, dir)).code, 0);
    assertEquals((await runSpecnaut(["upgrade"], dir)).code, 0);

    const after = await Deno.readTextFile(join(dir, "AGENTS.md"));
    const body = after.slice(after.indexOf(UI_START), after.indexOf(UI_END));
    assert(body.length > 0, "no ui-defaults block");
    // Asserting on the BODY, not the file: fences wrapped around nothing would
    // satisfy every assertion above and deliver no instruction at all.
    assertStringIncludes(body, "mobile-first-contract");
    assertEquals(occurrences(after, UI_START), 1, "grafted twice");
  });
});

const RS_START = "<!-- --- Specnaut: response-style --- -->";
const RS_END = "<!-- --- End Specnaut: response-style --- -->";

Deno.test("the response-style graft carries the pointer, not just its fences", async () => {
  // #575. The AGENTS.md fence is the ONLY route by which an existing project
  // receives this contract — `AGENTS.md` is skipIfExists, so the pointer line
  // outside the fence reaches new projects and nobody else.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "AGENTS.md"), "# AGENTS.md\n\nOurs.\n");
    assertEquals((await runSpecnaut(INIT, dir)).code, 0);
    assertEquals((await runSpecnaut(["upgrade"], dir)).code, 0);

    const after = await Deno.readTextFile(join(dir, "AGENTS.md"));
    const body = after.slice(after.indexOf(RS_START), after.indexOf(RS_END));
    assert(body.length > 0, "no response-style block");
    // The BODY, not the file: fences wrapped around nothing would satisfy every
    // assertion above and deliver no instruction at all.
    assertStringIncludes(body, "response-style-contract");
    assertEquals(occurrences(after, RS_START), 1, "grafted twice");
    assertStringIncludes(after, "Ours.");
  });
});

Deno.test("an orphan fence above the block does not cost the user their content", async () => {
  // The state probed in tests/domain/merge_block_orphan_test.ts, driven through
  // the real upgrade path — because the guard lives in the domain but the harm
  // lands here, on a file written with backupExisting: false.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "AGENTS.md"), "# AGENTS.md\n\nOurs.\n");
    assertEquals((await runSpecnaut(INIT, dir)).code, 0);
    assertEquals((await runSpecnaut(["upgrade"], dir)).code, 0);

    const scaffolded = await Deno.readTextFile(join(dir, "AGENTS.md"));
    // Someone pastes a stray start marker above the block, then writes below it.
    const sabotaged = scaffolded.replace(
      "# AGENTS.md",
      `# AGENTS.md\n\n${RS_START}\n\n## My own notes\nKEEP-ME-1\nKEEP-ME-2\n`,
    );
    await Deno.writeTextFile(join(dir, "AGENTS.md"), sabotaged);
    assertEquals((await runSpecnaut(["upgrade"], dir)).code, 0);

    const after = await Deno.readTextFile(join(dir, "AGENTS.md"));
    assertStringIncludes(after, "KEEP-ME-1");
    assertStringIncludes(after, "KEEP-ME-2");
    assertStringIncludes(after, "## My own notes");
    assertStringIncludes(after, "response-style-contract");
  });
});
