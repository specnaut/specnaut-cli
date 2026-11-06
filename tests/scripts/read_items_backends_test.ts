import { assertEquals } from "@std/assert";
import { localItem } from "./backlog_tracker_fixture.ts";
import { gitProject, readItems, removeRead } from "./read_items_fixture.ts";

/**
 * `read-items.sh` on the backends beside GitHub: the same file, from each
 * backend's own `item-record.sh` — a column listed through `list.sh --numbers`
 * on the local backend, the signed-in user resolved once on GitLab.
 */

Deno.test("local: --status reads the column's items, the --id first and once, zero padding dropped", async () => {
  const p = await gitProject("local");
  let read;
  try {
    await p.write(".specnaut/backlog/003-a.md", localItem("003", "A"));
    await p.write(".specnaut/backlog/005-b.md", localItem("005", "B: status: Done"));
    await p.write(".specnaut/backlog/009-c.md", localItem("009", "C").replace("Ready", "Backlog"));
    const out = await readItems(p, ["groom", "--id", "005", "--status", "Ready"]);
    read = out.read;
    assertEquals(out.r.code, 0, out.r.stderr);
    assertEquals([read!.items, read!.header.id], ["5 3", "5"]);
    const titles = read!.blocks.filter((b) => b.field === "title").map((b) => [b.item, b.value]);
    assertEquals(titles, [["5", "B: status: Done"], ["3", "A"]]);
    assertEquals(read!.outside.filter((l) => l.startsWith("status:")), [
      "status: Ready",
      "status: Ready",
    ]);
    assertEquals(
      read!.outside.filter((l) => l.startsWith("created:"))[0],
      "created: 2026-01-01T00:00:00Z",
    );
  } finally {
    await removeRead(read);
    await p.cleanup();
  }
});

Deno.test("local: an empty column writes a file with no items", async () => {
  const p = await gitProject("local");
  let read;
  try {
    const out = await readItems(p, ["groom", "--status", "Ready"]);
    read = out.read;
    assertEquals([out.r.code, read!.items, read!.blocks.length], [0, "none", 0], out.r.stderr);
  } finally {
    await removeRead(read);
    await p.cleanup();
  }
});

Deno.test("gitlab: by_viewer compares each author with the signed-in user", async () => {
  const p = await gitProject("gitlab");
  let read;
  try {
    const issue = {
      iid: 4,
      title: "T",
      description: "Body",
      created_at: "2026-02-03T04:05:06.789Z",
      labels: ["Status::Ready"],
      state: "opened",
      author: { id: 2, username: "someone" },
    };
    const notes = [
      { body: "mine", system: false, author: { id: 1, username: "me" } },
      { body: "label", system: true, author: { id: 1, username: "me" } },
    ];
    await p.write("issue.json", JSON.stringify(issue));
    await p.write("notes.json", JSON.stringify(notes));
    await p.write(
      "bin/glab",
      `#!/usr/bin/env bash
case "$1 $2" in
  "api user") echo '{"id":1}' ;;
  "issue view") cat "$FAKE_ROOT/issue.json" ;;
  api*) cat "$FAKE_ROOT/notes.json" ;;
  *) exit 1 ;;
esac
`,
    );
    const out = await readItems(p, ["edit", "--id", "4"]);
    read = out.read;
    assertEquals(out.r.code, 0, out.r.stderr);
    assertEquals(
      read!.blocks.map((b) => [b.field, b.author, b.association, b.byViewer]),
      [
        ["title", "someone", "UNKNOWN", "false"],
        ["body", "someone", "UNKNOWN", "false"],
        ["comment", "me", "UNKNOWN", "true"],
      ],
    );
    assertEquals(read!.outside.filter((l) => l.startsWith("created:")), [
      "created: 2026-02-03T04:05:06Z",
    ]);
  } finally {
    await removeRead(read);
    await p.cleanup();
  }
});
