import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ghIssue, ghProject, jsonl, readThenApply } from "./apply_plan_fixture.ts";
import { gitProject } from "./read_items_fixture.ts";

/**
 * GitLab runs a quick action — a line of an issue's text that starts with `/`
 * and a word: `/close`, `/label`, `/set_parent` — with the token of whoever
 * wrote the text. Text that reaches GitLab through the backlog scripts holds
 * none, planned or direct, and an edit never rewrites a description that
 * holds one. GitHub runs none, so the same text passes there.
 */

/** A stand-in glab: logs argv; the description is fake/description when present. */
const GLAB = `#!/usr/bin/env bash
printf glab >> "$FAKE_ROOT/calls.log"
for a in "$@"; do printf '\\t%s' "$a" >> "$FAKE_ROOT/calls.log"; done
echo >> "$FAKE_ROOT/calls.log"
d=Body; [ ! -f "$FAKE_ROOT/fake/description" ] || d=$(cat "$FAKE_ROOT/fake/description")
case "$1 $2" in
  "api user") echo '{"id":1}' ;;
  "issue view") jq -cn --arg d "$d" '{iid:4,title:"T",description:$d,created_at:"2026-02-03T04:05:06Z",labels:[],state:"opened",author:{id:2,username:"someone"}}' ;;
  "issue list") echo '[]' ;;
  api*) echo '[]' ;;
esac
`;

const WRITES = /^glab\tissue\t(note|update|create|close)/m;

async function gitlab() {
  const p = await gitProject("gitlab");
  await p.write("bin/glab", GLAB);
  await Deno.mkdir(join(p.dir, "fake"), { recursive: true });
  return p;
}

const ACTIONS = ["/close", "Done.\n  /label ~bug", "See this.\n/relate #9", "\t/set_parent #2"];

Deno.test("gitlab: a plan line that is a quick action is refused, and nothing is sent", async () => {
  const p = await gitlab();
  try {
    for (const body of ACTIONS) {
      const out = await readThenApply(
        p,
        ["edit", "--id", "4"],
        jsonl({ op: "comment", target: 4, body }),
      );
      assertEquals(
        [out.code, out.lines],
        [3, ["REFUSED quick-action 1.body", "RECEIPT: none"]],
        body,
      );
      assert(!WRITES.test(out.calls), out.calls);
    }
    const append = jsonl({ op: "edit", target: 4, append: "More.\n/close" });
    const edit = await readThenApply(p, ["edit", "--id", "4"], append);
    assertEquals(edit.lines, ["REFUSED quick-action 1.append", "RECEIPT: none"]);
    // A slash that does not open a line, or a path, is text.
    const plain = await readThenApply(
      p,
      ["edit", "--id", "4"],
      jsonl({ op: "comment", target: 4, body: "Run it as a/b, or see /4 and docs/close.md" }),
    );
    assertEquals(plain.lines, ["APPLIED comment 4", "RECEIPT: none"], plain.stderr);
  } finally {
    await p.cleanup();
  }
});

Deno.test("gitlab: the direct writers refuse a quick action, with no call to glab", async () => {
  const p = await gitlab();
  try {
    const note = await p.run("clarify-comment.sh", ["4", "Which tenant?\r/close"]);
    assertEquals(note.code, 14, note.stderr);
    assertStringIncludes(note.stderr, "REFUSED quick-action body");
    const add = await p.run("add.sh", ["New item", "Why.\n/assign @someone"]);
    assertEquals(add.code, 14, add.stderr);
    assert(!WRITES.test(note.calls + add.calls), note.calls + add.calls);
  } finally {
    await p.cleanup();
  }
});

Deno.test("gitlab: an edit never rewrites a description that already holds a quick action", async () => {
  const p = await gitlab();
  try {
    await p.write("fake/description", "Filed text.\n/close");
    await p.write("more.md", "More detail.\n");
    const out = await p.run("edit.sh", ["4", "--append-file", join(p.dir, "more.md")]);
    assertEquals(out.code, 14, out.stderr);
    assertStringIncludes(out.stderr, "REFUSED quick-action description");
    assert(!WRITES.test(out.calls), out.calls);
  } finally {
    await p.cleanup();
  }
});

Deno.test("github: a line starting with a slash is text, not a quick action", async () => {
  const p = await ghProject({ 7: ghIssue("Export times out") });
  try {
    const out = await readThenApply(
      p,
      ["edit", "--id", "7"],
      jsonl({ op: "comment", target: 7, body: "/close" }),
    );
    assertEquals(out.lines, ["APPLIED comment 7", "RECEIPT: none"], out.stderr);
  } finally {
    await p.cleanup();
  }
});
