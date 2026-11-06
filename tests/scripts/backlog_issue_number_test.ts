import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { type Backend, BACKENDS, localItem, project, SCRIPTS } from "./backlog_tracker_fixture.ts";

/**
 * Every backlog script that takes an issue id accepts digits and nothing else,
 * through `require_issue_number` in its backend's `_config.sh`. An id reaches a
 * URL path, a query variable, a JSON number or a file glob, so a value that is
 * a URL, a flag, an `@file` argument, query text or a relative path is refused
 * with exit 2 (the script's own usage code where it has another) before
 * anything carries it to a tracker or the file system.
 */

const NOT_IDS = [
  "https://github.com/acme/other/issues/1",
  '1){id}} mutation{closeIssue(input:{issueId:"x"}){clientMutationId}}#',
  "@/etc/hosts",
  "--repo=acme/other",
  "../decoy",
  "0",
  "12345678901",
];

/** [script, its arguments around the id, the exit a refusal takes]. */
type Case = [string, (id: string) => string[], number];
const COMMON: Case[] = [
  ["view.sh", (id) => [id], 2],
  ["clarify-comment.sh", (id) => [id, "a question"], 2],
  ["move.sh", (id) => [id, "Done"], 2],
  ["parent-of.sh", (id) => [id], 2],
  ["cascade-check.sh", (id) => [id], 2],
  ["groom-verify.sh", (id) => [id], 2],
  ["item-record.sh", (id) => [id], 2],
  ["add.sh", (id) => ["A title", "--parent", id], 2],
  ["apply-plan.sh", (id) => ["edit", "--id", id, "plan.jsonl", "items.txt"], 2],
];
/** The scripts the executor calls, where a backend has them. */
const WRITERS: Case[] = [
  ["edit.sh", (id) => [id, "--title", "A title"], 2],
  ["close.sh", (id) => [id], 2],
  // Both positions at once: neither number may reach the tracker.
  ["link.sh", (id) => [id, id], 2],
];
const CASES: Record<Backend, Case[]> = {
  github: [
    ...COMMON,
    ...WRITERS,
    ["label.sh", (id) => [id, "bug"], 2],
    ["move-batch.sh", (id) => ["Done", id], 2],
    // set-field.sh keeps its own table: 1 is its usage code.
    ["set-field.sh", (id) => [id, "Priority", "P1"], 1],
    // Propagation never fails the move that triggered it: it refuses and exits 0.
    ["propagate-parent-status.sh", (id) => [id, "Ready"], 0],
  ],
  gitlab: [
    ...COMMON,
    ...WRITERS,
    ["label.sh", (id) => [id, "bug"], 2],
    ["set-field.sh", (id) => [id, "Priority", "P1"], 1],
  ],
  local: [
    ...COMMON,
    ...WRITERS,
    ["set-field.sh", (id) => [id, "Priority", "P1"], 1],
    ["propagate-parent-status.sh", (id) => [id, "Ready"], 0],
  ],
  cloud: COMMON,
};

/** Whether any logged argument carries `id` — whole, for an id too short to search for. */
const reached = (calls: string, id: string) =>
  calls.split(/[\t\n]/).some((f) => f === id || (id.length > 2 && f.includes(id)));

/**
 * cloud's groom-verify.sh refuses a non-number before it resolves a token, in
 * its own words ("not a task number"); the item-record.sh it runs then refuses
 * 0 and an overlong number through the helper ("not an issue number").
 */
const marker = (backend: Backend, script: string) =>
  backend === "cloud" && script === "groom-verify.sh"
    ? ".sh: not a"
    : `${script}: not an issue number:`;

for (const backend of BACKENDS) {
  for (const [script, args, code] of CASES[backend]) {
    Deno.test(`${backend} ${script}: an id that is not a number is refused before any tracker call`, async () => {
      const p = await project(backend);
      try {
        await p.write(".specnaut/decoy-x.md", "untouched\n");
        for (const id of NOT_IDS) {
          const r = await p.run(script, args(id));
          const seen = `${id}\n${r.stdout}${r.stderr}`;
          assertEquals(r.code, code, seen);
          assertStringIncludes(r.stderr, marker(backend, script), seen);
          assert(!reached(r.calls, id), `${id} reached the tracker:\n${r.calls}`);
          assertEquals(await p.read(".specnaut/decoy-x.md"), "untouched\n", seen);
        }
      } finally {
        await p.cleanup();
      }
    });
  }
}

Deno.test("local: a zero-padded id names that item, read in base 10", async () => {
  const p = await project("local");
  try {
    // 042 read as octal is 34: the wrong item, silently.
    await p.write(".specnaut/backlog/034-decoy.md", localItem("034", "Decoy"));
    await p.write(".specnaut/backlog/042-target.md", localItem("042", "Target"));
    const view = await p.run("view.sh", ["042"]);
    assertEquals(view.code, 0, view.stderr);
    assertStringIncludes(view.stdout, "title: Target");
    const note = await p.run("clarify-comment.sh", ["042", "Which export?"]);
    assertEquals(note.code, 0, note.stderr);
    assertStringIncludes(await p.read(".specnaut/backlog/042-target.md"), "Which export?");
    assert(!(await p.read(".specnaut/backlog/034-decoy.md")).includes("Which export?"));
  } finally {
    await p.cleanup();
  }
});

Deno.test("github: a zero-padded id reaches gh as the bare number", async () => {
  const p = await project("github");
  try {
    const r = await p.run("view.sh", ["007"]);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.calls, "gh\tissue\tview\t7\t");
    assert(!r.calls.includes("007"), r.calls);
  } finally {
    await p.cleanup();
  }
});

/** The helper's text, from its comment to its closing brace. */
async function helper(backend: Backend): Promise<string> {
  const text = await Deno.readTextFile(join(SCRIPTS, backend, "_config.sh"));
  const start = text.indexOf("# require_issue_number <id>");
  assert(start >= 0, `${backend}/_config.sh has no require_issue_number`);
  return text.slice(start, text.indexOf("\n}\n", start) + 2);
}

Deno.test("every backend's _config.sh carries the same require_issue_number", async () => {
  const github = await helper("github");
  for (const backend of BACKENDS) assertEquals(await helper(backend), github, backend);
});
