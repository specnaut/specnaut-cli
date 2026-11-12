import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { localItem } from "./backlog_tracker_fixture.ts";
import { jsonl, readThenApply } from "./apply_plan_fixture.ts";
import { gitProject } from "./read_items_fixture.ts";

/**
 * `apply-plan.sh` beside GitHub: the same checks, each backend's own scripts,
 * an operation the backend cannot do answered UNSUPPORTED before any write,
 * and — on the local backend — a RECEIPT naming the files to stage.
 */

Deno.test("local: an add plan writes the task file, and the receipt names what changed", async () => {
  const p = await gitProject("local");
  try {
    const out = await readThenApply(
      p,
      ["add"],
      jsonl(
        { op: "create", ref: "@a", title: "Local item", body: "Why." },
        { op: "classify", target: "@a", axis: "Priority", value: "P1" },
        { op: "move", target: "@a", status: "Ready" },
      ),
    );
    assertEquals(out.code, 0, out.stdout + out.stderr);
    assertEquals(out.lines, [
      "APPLIED create 1",
      "APPLIED classify 1",
      "APPLIED move 1",
      "RECEIPT: .specnaut/backlog.md .specnaut/backlog/001-local-item.md",
    ]);
    const file = await p.read(".specnaut/backlog/001-local-item.md");
    assertStringIncludes(file, "\ntitle: Local item\nstatus: Ready\nsize:\npriority: P1\n");
    const label = await readThenApply(
      p,
      ["add"],
      jsonl({ op: "create", title: "X", labels: ["bug"] }),
    );
    assertEquals([label.code, label.lines], [3, ["UNSUPPORTED create", "RECEIPT: none"]]);
  } finally {
    await p.cleanup();
  }
});

Deno.test("local: a title is one line, so it never adds a frontmatter key", async () => {
  const p = await gitProject("local");
  try {
    const add = await p.run("add.sh", ["Title\nstatus: Done"]);
    assertEquals(add.code, 2, add.stderr);
    assertEquals([...Deno.readDirSync(`${p.dir}/.specnaut/backlog`)], []);
    await p.write(".specnaut/backlog/001-a.md", localItem("001", "A"));
    const edit = await p.run("edit.sh", ["1", "--title", "Literal \\nstatus: Done"]);
    assertEquals(edit.code, 0, edit.stderr);
    const fm = (await p.read(".specnaut/backlog/001-a.md")).split("---")[1];
    assertEquals(fm.split("\n").filter((l) => l.startsWith("status:")), ["status: Ready"]);
    assertStringIncludes(fm, "title: Literal \\nstatus: Done\n");
  } finally {
    await p.cleanup();
  }
});

Deno.test("local: an epic with an open child is not closed; once the child is done, it is", async () => {
  const p = await gitProject("local");
  try {
    // In Backlog, so the child's move to Done does not promote it first.
    await p.write(
      ".specnaut/backlog/001-epic.md",
      localItem("001", "Epic").replace("Ready", "Backlog"),
    );
    await p.write(
      ".specnaut/backlog/002-child.md",
      localItem("002", "Child").replace("status: Ready", 'status: Backlog\nparent: "#001"'),
    );
    const plan = jsonl({ op: "close", target: 1, reason: "completed" });
    const blocked = await readThenApply(p, ["close", "--id", "1", "2"], plan);
    assertEquals([blocked.code, blocked.lines], [4, ["FAILED close 1 11", "RECEIPT: none"]]);
    assertStringIncludes(await p.read(".specnaut/backlog/001-epic.md"), "status: Backlog");
    assertEquals((await p.run("move.sh", ["2", "Done"])).code, 0);
    const cleared = await readThenApply(p, ["close", "--id", "1", "2"], plan);
    assertEquals(cleared.lines[0], "APPLIED close 1", cleared.stdout + cleared.stderr);
    assertStringIncludes(cleared.lines[1], ".specnaut/backlog/001-epic.md");
    assertStringIncludes(await p.read(".specnaut/backlog/001-epic.md"), "status: Done");
  } finally {
    await p.cleanup();
  }
});

Deno.test("local: an edit renames the item and appends to its body; a link records the parent on both files", async () => {
  const p = await gitProject("local");
  try {
    await p.write(".specnaut/backlog/001-epic.md", localItem("001", "Epic"));
    await p.write(".specnaut/backlog/002-child.md", localItem("002", "Child"));
    const edit = await readThenApply(
      p,
      ["edit", "--id", "1"],
      jsonl({ op: "edit", target: 1, title: "Renamed", append: "Added." }),
    );
    assertEquals(edit.lines[0], "APPLIED edit 1", edit.stdout + edit.stderr);
    assertEquals(
      await p.read(".specnaut/backlog/001-epic.md"),
      localItem("001", "Renamed", "Body.\n\nAdded.\n"),
    );
    const link = await readThenApply(
      p,
      ["groom", "1", "2"],
      jsonl({ op: "link", target: 2, parent: 1 }),
    );
    assertEquals(link.lines[0], "APPLIED link 2", link.stdout + link.stderr);
    assertStringIncludes(link.lines[1], ".specnaut/backlog/002-child.md");
    assertStringIncludes(await p.read(".specnaut/backlog/002-child.md"), '\nparent: "#001"\n');
    assertStringIncludes(
      await p.read(".specnaut/backlog/001-epic.md"),
      "Added.\n\n## Sub-tasks\n\n- #002 — Child\n",
    );
  } finally {
    await p.cleanup();
  }
});

Deno.test("cloud: a create travels in the JSON payload; what the contract lacks is unsupported", async () => {
  const p = await gitProject("cloud");
  try {
    const out = await readThenApply(
      p,
      ["tech-debt"],
      jsonl({ op: "create", title: "A $(touch m) debt", body: "Why." }),
    );
    assertEquals(out.lines, ["APPLIED create 5", "RECEIPT: none"], out.stderr);
    // The payload is the request body, sent from a file, never an argument.
    assertEquals(out.bodies.length, 1, out.calls);
    const sent = JSON.parse(out.bodies[0]);
    assertEquals([sent.title, sent.body], ["A $(touch m) debt", "Why."], out.bodies[0]);
    assert(!out.calls.includes("touch m"), out.calls);
    const label = await readThenApply(
      p,
      ["tech-debt"],
      jsonl({ op: "create", title: "X", labels: ["bug"] }),
    );
    assertEquals([label.code, label.lines[0]], [3, "UNSUPPORTED create"]);
    assert(!label.calls.includes("POST"), label.calls);
  } finally {
    await p.cleanup();
  }
});
