import { assert, assertEquals } from "@std/assert";
import { extractParent, findChildren, formatParentFrontmatter } from "../helpers/parent_link.ts";

Deno.test("extractParent returns the zero-padded number from #NNN", () => {
  const fm = `---
number: 003
title: Subtask of 1
status: Backlog
parent: "#001"
---

body`;
  assertEquals(extractParent(fm), "001");
});

Deno.test("extractParent handles unquoted #NNN", () => {
  const fm = `---
parent: #042
---`;
  assertEquals(extractParent(fm), "042");
});

Deno.test("extractParent returns null when key is missing", () => {
  const fm = `---
number: 001
title: Top-level
---`;
  assertEquals(extractParent(fm), null);
});

Deno.test("extractParent returns null when value is null literal", () => {
  const fm = `---
parent: null
---`;
  assertEquals(extractParent(fm), null);
});

Deno.test("extractParent returns null on empty string", () => {
  assertEquals(extractParent(""), null);
});

Deno.test("extractParent returns null when frontmatter is malformed (no fences)", () => {
  assertEquals(extractParent('parent: "#001"\nno fences'), null);
});

Deno.test("extractParent picks the first match when key appears twice", () => {
  const fm = `---
parent: "#001"
parent: "#999"
---`;
  assertEquals(extractParent(fm), "001");
});

Deno.test("extractParent ignores parent: lines outside frontmatter", () => {
  const fm = `---
number: 003
---

This task is the parent: "#999" of nobody.`;
  assertEquals(extractParent(fm), null);
});

Deno.test("formatParentFrontmatter zero-pads to 3 digits", () => {
  assertEquals(formatParentFrontmatter(1), 'parent: "#001"');
  assertEquals(formatParentFrontmatter(42), 'parent: "#042"');
  assertEquals(formatParentFrontmatter(999), 'parent: "#999"');
});

Deno.test("formatParentFrontmatter preserves widths >=3 digits", () => {
  assertEquals(formatParentFrontmatter(1000), 'parent: "#1000"');
});

Deno.test("formatParentFrontmatter throws on non-positive integers", () => {
  let threw = false;
  try {
    formatParentFrontmatter(0);
  } catch {
    threw = true;
  }
  assert(threw, "expected throw on 0");
});

Deno.test("findChildren returns files whose frontmatter has parent: #NNN", async () => {
  const dir = await Deno.makeTempDir({ prefix: "parent-link-test-" });
  try {
    await Deno.writeTextFile(
      `${dir}/001-parent.md`,
      `---\nnumber: 001\ntitle: Parent\nstatus: Backlog\n---\n`,
    );
    await Deno.writeTextFile(
      `${dir}/002-child-a.md`,
      `---\nnumber: 002\ntitle: Child A\nstatus: Backlog\nparent: "#001"\n---\n`,
    );
    await Deno.writeTextFile(
      `${dir}/003-child-b.md`,
      `---\nnumber: 003\ntitle: Child B\nstatus: Ready\nparent: "#001"\n---\n`,
    );
    await Deno.writeTextFile(
      `${dir}/004-unrelated.md`,
      `---\nnumber: 004\ntitle: Unrelated\nstatus: Backlog\n---\n`,
    );

    const children = await findChildren(dir, "001");
    assertEquals(children.sort(), [
      `${dir}/002-child-a.md`,
      `${dir}/003-child-b.md`,
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("findChildren returns empty array when no children exist", async () => {
  const dir = await Deno.makeTempDir({ prefix: "parent-link-test-" });
  try {
    await Deno.writeTextFile(
      `${dir}/001-parent.md`,
      `---\nnumber: 001\ntitle: Parent\n---\n`,
    );
    const children = await findChildren(dir, "001");
    assertEquals(children, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("findChildren ignores non-.md files", async () => {
  const dir = await Deno.makeTempDir({ prefix: "parent-link-test-" });
  try {
    await Deno.writeTextFile(
      `${dir}/002-child.md`,
      `---\nparent: "#001"\n---\n`,
    );
    await Deno.writeTextFile(
      `${dir}/notes.txt`,
      `---\nparent: "#001"\n---\n`,
    );
    const children = await findChildren(dir, "001");
    assertEquals(children, [`${dir}/002-child.md`]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
