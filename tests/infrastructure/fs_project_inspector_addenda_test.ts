import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import type { CheckOutcome } from "../../src/domain/check_result.ts";
import { worstStatusOf } from "../../src/domain/check_result.ts";
import { FsProjectInspector } from "../../src/infrastructure/fs_project_inspector.ts";

/**
 * #622 — `check --project` names every addendum the routers will never read.
 *
 * Since #611 a project extends a phase by writing
 * `.specnaut/addenda/<skill>/<phase>.md`. A mistyped or renamed path is read by
 * nothing and says nothing, so a guardrail written there is silently off. These
 * tests drive the real filesystem adapter; the naming rules themselves are
 * pinned in `tests/domain/addendum_audit_test.ts`.
 */

const TEMPLATES_VERSION = "0.2.0";

/** A project the other checks pass on, so an addenda warning is the only noise. */
async function healthyProject(dir: string): Promise<void> {
  await Deno.mkdir(join(dir, ".specnaut/memory"), { recursive: true });
  await Deno.mkdir(join(dir, ".claude"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".specnaut/memory/constitution.md"),
    "# Project Constitution\n\n- No silent catches.\n",
  );
  await Deno.writeTextFile(
    join(dir, ".specnaut/installed.lock"),
    `version: 2\nharness: claude\ntemplates_version: ${TEMPLATES_VERSION}\nentries: {}\n`,
  );
}

/** Runs the inspector on a healthy project carrying the given addenda files. */
async function inspectWithAddenda(files: ReadonlyArray<string>): Promise<CheckOutcome[]> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-addenda-" });
  try {
    await healthyProject(dir);
    for (const rel of files) {
      const path = join(dir, ".specnaut/addenda", rel);
      await Deno.mkdir(dirname(path), { recursive: true });
      await Deno.writeTextFile(path, "Before step 3, run the migration check.\n");
    }
    return await new FsProjectInspector().inspect(dir, TEMPLATES_VERSION);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const aboutAddenda = (o: CheckOutcome) =>
  o.name.includes("addenda") || o.message.includes("addend");

function outcomeFor(outcomes: ReadonlyArray<CheckOutcome>, rel: string): CheckOutcome {
  const name = `.specnaut/addenda/${rel}`;
  const found = outcomes.find((o) => o.name === name);
  assert(found, `no outcome named ${name} — got ${JSON.stringify(outcomes.map((o) => o.name))}`);
  return found;
}

Deno.test("check --project warns about a mistyped phase addendum and names the phase it meant", async () => {
  const outcomes = await inspectWithAddenda(["specnaut/planning.md"]);
  const o = outcomeFor(outcomes, "specnaut/planning.md");
  assertEquals(o.status, "warn");
  assertStringIncludes(o.message, ".specnaut/addenda/specnaut/plan.md");
});

Deno.test("check --project points a renamed phase's addendum at the new address, across skills", async () => {
  const outcomes = await inspectWithAddenda(["specnaut/tag-version.md"]);
  const o = outcomeFor(outcomes, "specnaut/tag-version.md");
  assertEquals(o.status, "warn");
  assertStringIncludes(o.message, ".specnaut/addenda/ship/tag.md");
});

Deno.test("check --project says a contract doc takes no addendum and points at its parent phase", async () => {
  const outcomes = await inspectWithAddenda(["specnaut/merge-squash.md"]);
  const o = outcomeFor(outcomes, "specnaut/merge-squash.md");
  assertEquals(o.status, "warn");
  assertStringIncludes(o.message, "contract doc");
  assertStringIncludes(o.message, ".specnaut/addenda/specnaut/merge.md");
});

Deno.test("check --project stays silent about valid addenda", async () => {
  const outcomes = await inspectWithAddenda([
    "specnaut/plan.md",
    "specnaut/audit-security.md",
    "ship/release.md",
  ]);
  assertEquals(outcomes.filter(aboutAddenda), []);
});

Deno.test("check --project says nothing at all when .specnaut/addenda/ does not exist", async () => {
  const outcomes = await inspectWithAddenda([]);
  assertEquals(outcomes.filter(aboutAddenda), []);
});

Deno.test("check --project ignores dotfiles under .specnaut/addenda/", async () => {
  const outcomes = await inspectWithAddenda([
    ".DS_Store",
    "specnaut/.DS_Store",
    "specnaut/.plan.md.swp",
  ]);
  assertEquals(outcomes.filter(aboutAddenda), []);
});

Deno.test("an addenda warning alone does not fail check — the worst status is warn", async () => {
  const outcomes = await inspectWithAddenda(["specnaut/reveiw.md"]);
  const o = outcomeFor(outcomes, "specnaut/reveiw.md");
  assertStringIncludes(o.message, ".specnaut/addenda/specnaut/review.md");
  // `runCheck` maps `warn` to exit 0; `fail` is the only status that exits 1.
  assertEquals(worstStatusOf(outcomes), "warn");
});

Deno.test("check --project lists wrong nesting, an unknown skill and a non-.md file", async () => {
  const outcomes = await inspectWithAddenda([
    "plan.md",
    "specnut/review.md",
    "ship/tag.txt",
  ]);
  assertStringIncludes(outcomeFor(outcomes, "plan.md").message, "specnaut/plan.md");
  assertStringIncludes(outcomeFor(outcomes, "specnut/review.md").message, "specnaut/review.md");
  assertStringIncludes(outcomeFor(outcomes, "ship/tag.txt").message, "ship/tag.md");
  for (const o of outcomes.filter(aboutAddenda)) assertEquals(o.status, "warn", o.name);
});

Deno.test("an addendum with no near phase is listed without a guess", async () => {
  const outcomes = await inspectWithAddenda(["specnaut/zzzzzzzz.md"]);
  const o = outcomeFor(outcomes, "specnaut/zzzzzzzz.md");
  assertEquals(o.status, "warn");
  assertEquals(o.message.includes("did you mean"), false, o.message);
});

Deno.test("a .specnaut/addenda that is a file, not a directory, warns instead of crashing check", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-addenda-" });
  try {
    await healthyProject(dir);
    await Deno.writeTextFile(join(dir, ".specnaut/addenda"), "plan: run the migration check\n");
    const outcomes = await new FsProjectInspector().inspect(dir, TEMPLATES_VERSION);
    const o = outcomeFor(outcomes, "");
    assertEquals(o.status, "warn");
    assertStringIncludes(o.message, "not a directory");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
