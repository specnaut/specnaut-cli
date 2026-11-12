import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { jsonl, readThenApply } from "./apply_plan_fixture.ts";
import { gitProject } from "./read_items_fixture.ts";

/**
 * `apply-plan.sh` beside GitLab, through its real entry point: what each
 * operation hands `glab`, read back from the stand-in's log. An argument is
 * logged as it arrived, newlines included; a request body read on stdin
 * (`--input -`) follows on a `BODY` line.
 */

const GLAB = `#!/usr/bin/env bash
printf glab >> "$FAKE_ROOT/calls.log"
for a in "$@"; do printf '\\t%s' "$a" >> "$FAKE_ROOT/calls.log"; done
echo >> "$FAKE_ROOT/calls.log"
case " $* " in *" --input - "*) printf 'BODY\\t%s\\n' "$(cat)" >> "$FAKE_ROOT/calls.log" ;; esac
case "$1 $2" in
  "api user") echo '{"id":1}' ;;
  "issue view") echo '{"iid":4,"title":"T","description":"Body","created_at":"2026-02-03T04:05:06Z","labels":[],"state":"opened","author":{"id":2,"username":"someone"}}' ;;
  "api --paginate") echo '[{"name":"bug"},{"name":"Status::Done"},{"name":"parent::#9"},{"name":"PRIORITY::P0"}]' ;;
  "issue list") echo '[]' ;;
  api*) echo '[]' ;;
esac
`;

async function gitlab() {
  const p = await gitProject("gitlab");
  await p.write("bin/glab", GLAB);
  return p;
}

Deno.test("gitlab: a classification is its scoped label; a close reason it cannot record is unsupported", async () => {
  const p = await gitlab();
  try {
    const out = await readThenApply(
      p,
      ["edit", "--id", "4"],
      jsonl(
        { op: "classify", target: 4, axis: "Priority", value: "P1" },
        { op: "label", target: 4, labels: ["bug"] },
      ),
    );
    assertEquals(out.lines, ["APPLIED classify 4", "APPLIED label 4", "RECEIPT: none"], out.stderr);
    assertStringIncludes(
      out.calls,
      "glab\tissue\tupdate\t4\t--repo\tacme/my-app\t--label\tpriority::P1\n",
    );
    assertStringIncludes(out.calls, "glab\tissue\tupdate\t4\t--repo\tacme/my-app\t--label\tbug\n");
    const close = await readThenApply(
      p,
      ["close", "--id", "4"],
      jsonl({ op: "close", target: 4, reason: "not_planned" }),
    );
    assertEquals([close.code, close.lines], [3, ["UNSUPPORTED close", "RECEIPT: none"]]);
    assert(!/glab\t(issue\t(close|update)|api\t-X)/.test(close.calls), close.calls);
  } finally {
    await p.cleanup();
  }
});

Deno.test("gitlab: an edit sends the old description, a blank line, then the appended text", async () => {
  const p = await gitlab();
  try {
    const out = await readThenApply(
      p,
      ["edit", "--id", "4"],
      jsonl({ op: "edit", target: 4, title: "New title", append: "More text.\nSecond line." }),
    );
    assertEquals([out.code, out.lines], [0, ["APPLIED edit 4", "RECEIPT: none"]], out.stderr);
    assertStringIncludes(
      out.calls,
      "glab\tapi\t-X\tPUT\tprojects/acme%2Fmy-app/issues/4\t-H\tContent-Type: application/json" +
        "\t--input\t-\nBODY\t" +
        JSON.stringify({ title: "New title", description: "Body\n\nMore text.\nSecond line." }) +
        "\n",
    );
  } finally {
    await p.cleanup();
  }
});

Deno.test("gitlab: a link sets the child's parent label", async () => {
  const p = await gitlab();
  try {
    const out = await readThenApply(
      p,
      ["groom", "4", "6"],
      jsonl({ op: "link", target: 6, parent: 4 }),
    );
    assertEquals([out.code, out.lines], [0, ["APPLIED link 6", "RECEIPT: none"]], out.stderr);
    assertStringIncludes(
      out.calls,
      "glab\tissue\tupdate\t6\t--repo\tacme/my-app\t--label\tparent::#4\n",
    );
  } finally {
    await p.cleanup();
  }
});

Deno.test("gitlab: a plan names no scoped label the executor sets itself", async () => {
  const p = await gitlab();
  try {
    const cases: ReadonlyArray<[string[], unknown]> = [
      [["edit", "--id", "4"], { op: "label", target: 4, labels: ["Status::Done"] }],
      [["edit", "--id", "4"], { op: "label", target: 4, labels: ["PRIORITY::P0"] }],
      [["add"], { op: "create", title: "New item", labels: ["parent::#9"] }],
    ];
    for (const [read, op] of cases) {
      const out = await readThenApply(p, read, jsonl(op));
      const seen = `${JSON.stringify(op)}\n${out.stdout}${out.stderr}`;
      assertEquals([out.code, out.lines], [3, ["REFUSED label 1.labels", "RECEIPT: none"]], seen);
      assert(!/glab\t(issue\t(create|update)|api\t-X)/.test(out.calls), out.calls);
    }
  } finally {
    await p.cleanup();
  }
});
