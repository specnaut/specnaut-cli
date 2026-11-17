import { assertEquals } from "@std/assert";
import { supersededVerbEdits } from "../../src/application/superseded_verb_rows.ts";
import { gatherPlanInputs } from "../../src/application/upgrade_plan_inputs.ts";
import { sha256Hex } from "../../src/domain/sha256.ts";
import type { Bundle } from "../../src/domain/template.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import { fakeReader, fakeWriter } from "./upgrade_fakes.ts";

/**
 * Which customised routers a verb the bundle now ships supersedes (cli#803):
 * the lock SHA is the proof — the disk minus the dropped rows is the file
 * Specnaut last wrote. Synthetic routers.
 */

const R = "skills/task/SKILL.md";
const row = (verb: string, text: string) => `| \`${verb}\` | \`backlog.md\` | ${text} |`;
const router = (...rows: string[]) =>
  ["# Router", "## Verbs", ...rows, "## Routing", ""].join("\n");

/** Last installed: `list`, worded as an older release worded it. */
const OLD = router(row("list", "Overview"));
/** This bundle: `list` reworded, and `kanban` shipped. */
const BUNDLED = router(
  row("list", "Backlog overview"),
  row("kanban [--no-open]", "Open the board"),
);
const LOCAL = "| `kanban` | `../board/SKILL.md` | Our own board |";

async function edits(disk: string, opts: { declared?: boolean; mergeBlock?: string } = {}) {
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "9.3.0",
    entries: new Map([[R, {
      sha256: await sha256Hex(OLD),
      installedAt: "2026-01-01T00:00:00Z",
      templatesVersion: "9.3.0",
    }]]),
  };
  const bundle: Bundle = {
    [R]: {
      content: BUNDLED,
      executable: false,
      ...opts.mergeBlock !== undefined ? { mergeBlock: opts.mergeBlock } : {},
    },
  };
  const ctx = {
    reader: fakeReader({ [R]: disk }),
    projectDir: "/p",
    isDeclaredPreserved: () => opts.declared === true,
  };
  return {
    lock,
    bundle,
    ctx,
    out: await supersededVerbEdits(ctx, bundle, lock, new Map([[R, await sha256Hex(disk)]])),
  };
}

Deno.test("a router whose one edit is a row for a shipped verb is superseded, the row quoted", async () => {
  const { out } = await edits(router(row("list", "Overview"), LOCAL));
  assertEquals([...out.dests], [R]);
  assertEquals(out.notes.length, 1);
  assertEquals(
    out.notes[0],
    `${R}: the local row is dropped ("${LOCAL}"); the bundled \`kanban\` takes over`,
  );
});

Deno.test("an older wording of another row is kept out of the drop: only the local row goes", async () => {
  // The candidates are both rows; only dropping the local one restores the lock's bytes.
  const { out } = await edits(router(row("list", "Overview"), LOCAL));
  assertEquals(out.notes[0].match(/"\|/g)?.length, 1, out.notes[0]);
});

Deno.test("a row for a verb the last-installed router already routed is the project's own, kept", async () => {
  // Dropping either row restores the lock's bytes; `list` was routed then, so neither is a new verb.
  for (
    const own of ["| `list --all` | `../all/SKILL.md` | Every item |", row("list", "Elsewhere")]
  ) {
    const { out } = await edits(router(row("list", "Overview"), own));
    assertEquals([[...out.dests], out.notes], [[], []], own);
  }
});

Deno.test("any other edit keeps the router a customisation", async () => {
  const { out } = await edits(router(row("list", "Overview"), LOCAL) + "our own house rule\n");
  assertEquals([[...out.dests], out.notes], [[], []]);
});

Deno.test("a declared preserve, an untouched file and a merge block are never asked", async () => {
  for (
    const [disk, opts] of [
      [router(row("list", "Overview"), LOCAL), { declared: true }],
      [OLD, {}],
      [router(row("list", "Overview"), LOCAL), { mergeBlock: "x" }],
    ] as const
  ) {
    const { out } = await edits(disk, opts);
    assertEquals([[...out.dests], out.notes], [[], []], JSON.stringify(opts));
  }
});

Deno.test("the plan inputs carry the superseded dest, and its note among the refusals", async () => {
  const disk = router(row("list", "Overview"), LOCAL);
  const { lock, bundle } = await edits(disk);
  const io = { reader: fakeReader({ [R]: disk }), writer: fakeWriter(), dryRun: true };
  const inputs = await gatherPlanInputs(io, "/p", bundle, lock, () => false);
  assertEquals([...inputs.superseded], [R]);
  assertEquals(inputs.refusals.filter((r) => r.includes(LOCAL)).length, 1);
});
