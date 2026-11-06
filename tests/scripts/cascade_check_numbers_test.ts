import { assertEquals, assertStringIncludes } from "@std/assert";
import { localItem, project } from "./backlog_tracker_fixture.ts";
import { ghIssue, ghProject } from "./apply_plan_fixture.ts";

/**
 * `cascade-check.sh --numbers <n>` lists the children of <n>, one number a
 * line and nothing else, whatever their state: the numbers a `close <id>` read
 * passes to read-items.sh. Every backend, through its real script and a
 * stand-in tracker CLI. A child's title never adds a number.
 */

const ODD_TITLE = "x\nopen\t#99 — y";
const KIDS = JSON.stringify([
  { state: "closed", number: 10, title: ODD_TITLE },
  { state: "open", number: 11, title: "z" },
]);

Deno.test("cascade-check --numbers [github]: every child's number, open or closed", async () => {
  const p = await ghProject({ 9: ghIssue("An epic") }, { "children-9.json": KIDS });
  try {
    const out = await p.run("cascade-check.sh", ["--numbers", "9"]);
    assertEquals([out.code, out.stdout], [0, "10\n11\n"], out.stderr);
    // The gate itself counts the two children: a title's newline is no third.
    const gate = await p.run("cascade-check.sh", ["9"]);
    assertEquals(gate.code, 11, gate.stdout);
    assertStringIncludes(gate.stdout, "has 1 open child issue(s) of 2");
    await p.write("bin/gh", "#!/usr/bin/env bash\nexit 1\n");
    const unread = await p.run("cascade-check.sh", ["--numbers", "9"]);
    assertEquals([unread.code, unread.stdout], [3, ""]);
    const bad = await p.run("cascade-check.sh", ["--numbers", "9x"]);
    assertEquals([bad.code, bad.stdout], [2, ""]);
  } finally {
    await p.cleanup();
  }
});

Deno.test("cascade-check --numbers [gitlab]: the issues labelled with the parent", async () => {
  const p = await project("gitlab");
  try {
    await p.write(
      "bin/glab",
      `#!/usr/bin/env bash
case "$1 $2" in
  "issue view") echo '{"iid":4,"state":"opened"}' ;;
  "issue list") echo '[{"iid":5,"state":"closed","title":"77"},{"iid":6,"state":"opened","title":"b"}]' ;;
esac
`,
    );
    const out = await p.run("cascade-check.sh", ["--numbers", "4"]);
    assertEquals([out.code, out.stdout], [0, "5\n6\n"], out.stderr);
  } finally {
    await p.cleanup();
  }
});

Deno.test("cascade-check --numbers [local]: the task files whose parent is the item", async () => {
  const p = await project("local");
  try {
    await p.write(".specnaut/backlog/001-epic.md", localItem("001", "Epic"));
    const child = (n: string, s: string) =>
      localItem(n, "Child").replace("status: Ready", `status: ${s}\nparent: "#001"`);
    await p.write(".specnaut/backlog/002-child.md", child("002", "Done"));
    await p.write(".specnaut/backlog/013-child.md", child("013", "Ready"));
    await p.write(".specnaut/backlog/004-other.md", localItem("004", "Other"));
    const out = await p.run("cascade-check.sh", ["--numbers", "1"]);
    assertEquals([out.code, out.stdout], [0, "2\n13\n"], out.stderr);
    const missing = await p.run("cascade-check.sh", ["--numbers", "7"]);
    assertEquals([missing.code, missing.stdout], [3, ""]);
  } finally {
    await p.cleanup();
  }
});

Deno.test("cascade-check --numbers [cloud]: the tasks the board lists under the parent", async () => {
  const p = await project("cloud");
  try {
    await p.write(
      "bin/curl",
      `#!/usr/bin/env bash
cat >/dev/null
case "$*" in
  *columns*) b='{"columns":[{"id":"c0","order":0,"name":"Ready"},{"id":"c1","order":1,"name":"Done"}]}' ;;
  *parentNumber=*) b='{"tasks":[{"number":7,"columnId":"c1","title":"a"},{"number":8,"columnId":"c0","title":"b"}]}' ;;
  *) b='{"task":{"number":3,"columnId":"c0"}}' ;;
esac
printf '%s\\n200' "$b"
`,
    );
    const out = await p.run("cascade-check.sh", ["--numbers", "3"]);
    assertEquals([out.code, out.stdout], [0, "7\n8\n"], out.stderr);
  } finally {
    await p.cleanup();
  }
});
