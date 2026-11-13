import { assert, assertEquals } from "@std/assert";
import type { ConfigFile } from "../../src/domain/config_trust.ts";
import { keptAtHead, NOT_A_FOLDER } from "../../src/domain/instruction_scope.ts";
import {
  COMMITTED_INSTRUCTIONS,
  type CommittedInstruction,
  INSTRUCTION_REASON,
} from "../../src/domain/instruction_trust.ts";
import { type BaseEntry, REASON } from "../../src/domain/script_trust.ts";
import { blob, enc, file, judge, walked } from "./instruction_trust_fixture.ts";

/**
 * The overrides a session loads beside the instruction files are read from HEAD alone, and a
 * name HEAD holds in another letter case, or a folder it holds as something else, is named.
 */

type Override = (typeof COMMITTED_INSTRUCTIONS)[number];
const overrides = (o: { committed: CommittedInstruction[]; head: BaseEntry[] }) =>
  judge({ tree: walked(), tip: [], ...o });
const on = (s: string) => ({ kind: "file" as const, bytes: enc(s) });
const none = { kind: "absent" as const };
/** One override at HEAD (listed, as a blob or not at all), the tip and the merge base. */
const committed = (path: Override, head: ConfigFile, tip: ConfigFile, mergeBase = tip) => ({
  committed: [{ path, tip, mergeBase }],
  head: head.kind === "file" ? [blob(path, head.bytes)] : [],
});

Deno.test("a committed override the tip lacks is named; one only in the work tree is not", () => {
  for (const path of COMMITTED_INSTRUCTIONS) {
    assertEquals(overrides(committed(path, on("x"), none)), [
      `${path} ${REASON.notOnBase}`,
    ]);
    assertEquals(overrides(committed(path, none, none)), ["trusted"]);
  }
});

Deno.test("a committed override that differs from the tip's is named; the same one is not", () => {
  for (const path of COMMITTED_INSTRUCTIONS) {
    assertEquals(overrides(committed(path, on("y"), on("x"))), [
      `${path} ${REASON.differs}`,
    ]);
    assertEquals(overrides(committed(path, on("x"), on("x"))), ["trusted"]);
    assertEquals(overrides(committed(path, on("y"), on("x"), on("y"))), [
      `${path} ${REASON.behind}`,
    ]);
  }
});

Deno.test("a committed override that differs from the tip's only in line endings says so", () => {
  const verdict = overrides(committed("CLAUDE.local.md", on("x\r\n"), on("x\n")));
  assertEquals(verdict, [`CLAUDE.local.md ${REASON.lineEndings}`]);
});

Deno.test("the committed overrides are the ones a session loads beside the instruction files", () => {
  assertEquals(COMMITTED_INSTRUCTIONS, [
    "AGENTS.override.md",
    "CLAUDE.local.md",
    ".claude/settings.local.json",
  ]);
});

Deno.test("an override HEAD holds under another letter case is named", () => {
  assertEquals(judge({ tree: walked(), tip: [], head: [blob("agents.override.md")] }), [
    `agents.override.md ${REASON.caseDiffers}`,
  ]);
});

Deno.test("an instruction file HEAD holds under a root of another letter case is named", () => {
  for (
    const path of [".Specnaut/addenda/task/merge.md", "Docs/constitution.md", ".CLAUDE/CLAUDE.md"]
  ) {
    assertEquals(judge({ tree: walked(), tip: [], head: [blob(path)] }), [
      `${path} ${REASON.caseDiffers}`,
    ], path);
  }
});

Deno.test("a name in another case that the tip holds as written is judged as any other", () => {
  const tip = [blob("agents.md")];
  assertEquals(judge({ tree: walked(file("agents.md")), tip, head: tip }), ["trusted"]);
});

Deno.test("a link, a file or a submodule HEAD holds where a root's folder should be is named", () => {
  const head: BaseEntry[] = [
    { kind: "link", path: ".specnaut", target: "elsewhere" },
    { kind: "submodule", path: "Docs" },
    blob(".claude", enc("x")),
  ];
  assertEquals(judge({ tree: walked(), tip: [], head }), [
    `.specnaut ${NOT_A_FOLDER}`,
    `Docs ${NOT_A_FOLDER}`,
    `.claude ${NOT_A_FOLDER}`,
  ]);
});

Deno.test("HEAD's listing keeps the instruction paths, overrides and folders in any case", () => {
  for (
    const kept of ["Agents.md", ".SPECNAUT/addenda/x.md", "claude.LOCAL.md", ".Specnaut", "DOCS"]
  ) {
    assert(keptAtHead(kept), kept);
  }
  for (
    const dropped of [
      "src/a.ts",
      ".specnaut/workflow.yml",
      "docs/other.md",
      ".claude/worktrees/x/README.md",
    ]
  ) {
    assert(!keptAtHead(dropped), dropped);
  }
});

Deno.test("a committed override holding invisible characters is named so", () => {
  const o = committed("CLAUDE.local.md", on("x\u200b\n"), none);
  assertEquals(overrides(o), [`CLAUDE.local.md ${INSTRUCTION_REASON.invisible}: U+200B (line 1)`]);
});
