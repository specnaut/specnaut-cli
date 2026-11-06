import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { jsonl, readThenApply } from "./apply_plan_fixture.ts";
import { gitProject } from "./read_items_fixture.ts";

/**
 * `apply-plan.sh` on a Cloud board whose last column is not called Done. The
 * terminal column is the last by order, whatever its name (`terminal_column`,
 * cloud/_config.sh): a plan never moves a task into it, and a close reaches it
 * only behind the cascade check — on the column the board itself names.
 */

/** Columns out of order, the terminal one called Shipped; kids.json lists #1's children. */
const CURL = `#!/usr/bin/env bash
printf curl >> "$FAKE_ROOT/calls.log"
for a in "$@"; do printf '\\t%s' "\${a//$'\\n'/ }" >> "$FAKE_ROOT/calls.log"; done
echo >> "$FAKE_ROOT/calls.log"
cat >/dev/null
case "$*" in
  *PATCH*) b='{"ok":true}' ;;
  *columns*) b='{"columns":[{"id":"c2","order":2,"name":"Shipped"},{"id":"c0","order":0,"name":"Backlog"},{"id":"c1","order":1,"name":"Ready"}]}' ;;
  *parentNumber=*) b=$(cat "$FAKE_ROOT/fake/kids.json") ;;
  *number=*) u="$*"; n=\${u##*number=}; b='{"task":{"number":'"\${n%% *}"',"columnId":"c1","title":"Task","body":"Body."}}' ;;
esac
printf '%s\\n200' "$b"
`;

const NO_KIDS = '{"tasks":[]}';
const OPEN_KID = '{"tasks":[{"number":2,"columnId":"c1","title":"Child"}]}';

async function cloudBoard(kids: string) {
  const p = await gitProject("cloud");
  await p.write("bin/curl", CURL);
  await Deno.mkdir(join(p.dir, "fake"));
  await p.write("fake/kids.json", kids);
  return p;
}

const PATCHES = /^curl\t.*-X\tPATCH/m;

Deno.test("cloud: a move to the terminal column is refused, whatever it is called", async () => {
  const p = await cloudBoard(NO_KIDS);
  try {
    const into = await readThenApply(
      p,
      ["edit", "--id", "1"],
      jsonl({ op: "move", target: 1, status: "Shipped" }),
    );
    assertEquals([into.code, into.lines], [3, ["REFUSED status 1.status", "RECEIPT: none"]]);
    assert(!PATCHES.test(into.calls), into.calls);
    const open = await readThenApply(
      p,
      ["edit", "--id", "1"],
      jsonl({ op: "move", target: 1, status: "Ready" }),
    );
    assertEquals([open.code, open.lines], [0, ["APPLIED move 1", "RECEIPT: none"]], open.stderr);
    assertStringIncludes(open.calls, '"status": "Ready"');
  } finally {
    await p.cleanup();
  }
});

Deno.test("cloud: a close passes the cascade check, then moves into the column the board names last", async () => {
  const p = await cloudBoard(OPEN_KID);
  try {
    const plan = jsonl({ op: "close", target: 1, reason: "completed" });
    const blocked = await readThenApply(p, ["close", "--id", "1"], plan);
    assertEquals([blocked.code, blocked.lines], [4, ["FAILED close 1 11", "RECEIPT: none"]]);
    assert(!PATCHES.test(blocked.calls), blocked.calls);
    await p.write("fake/kids.json", NO_KIDS);
    const closed = await readThenApply(p, ["close", "--id", "1"], plan);
    assertEquals(closed.lines, ["APPLIED close 1", "RECEIPT: none"], closed.stderr);
    assertStringIncludes(closed.calls, '"status": "Shipped"');
    assert(!closed.calls.includes('"status": "Done"'), closed.calls);
  } finally {
    await p.cleanup();
  }
});

Deno.test("cloud: columns.sh --terminal names the column a close moves into", async () => {
  const p = await cloudBoard(NO_KIDS);
  try {
    const out = await p.run("columns.sh", ["--terminal"]);
    assertEquals([out.code, out.stdout], [0, "Shipped\n"], out.stderr);
  } finally {
    await p.cleanup();
  }
});
