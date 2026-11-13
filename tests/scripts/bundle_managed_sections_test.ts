import { assertEquals, assertRejects } from "@std/assert";
import { toFileUrl } from "@std/path";
import {
  assertManagedSectionsFenced,
  fenceFaults,
  unfenced,
} from "../../scripts/bundle-managed-sections.ts";

/** A declared managed section the source does not fence fails the build (#466, #576). */

const fence = (label: string) =>
  `<!-- --- Specnaut: ${label} --- -->\nbody\n<!-- --- End Specnaut: ${label} --- -->\n`;

Deno.test("each declared label is checked, and only a start before its end counts", () => {
  const reversed = "<!-- --- End Specnaut: C --- -->\n<!-- --- Specnaut: C --- -->\n";
  const content = `${fence("A")}${reversed}`;
  assertEquals(unfenced("x.md", ["A", "B", "C"], content), [
    'x.md (label "B")',
    'x.md (label "C")',
  ]);
});

Deno.test("a label on a source that is not Markdown is a format fault, never read", async () => {
  const read: string[] = [];
  const core = [
    { category: "c", name: "a", source: "a.md", managedSection: ["A", "B"] },
    { category: "c", name: "b", source: "b.yml", managedSection: "Y" },
    { category: "c", name: "c", source: "c.md" },
  ];
  const faults = await fenceFaults(core, (s) => (read.push(s), Promise.resolve(fence("A"))));
  assertEquals(faults, { broken: ['a.md (label "B")'], wrongFormat: ['b.yml (label "Y")'] });
  assertEquals(read, ["a.md"]);
});

Deno.test("the build fails on a format fault first, then on an unfenced label", async () => {
  const dir = await Deno.makeTempDir({ prefix: "bundle-sections-" });
  try {
    await Deno.writeTextFile(`${dir}/a.md`, "no fence\n");
    const templates = toFileUrl(`${dir}/`);
    const md = [{ category: "c", name: "a", source: "a.md", managedSection: "A" }];
    const yml = [{ category: "c", name: "b", source: "b.yml", managedSection: "Y" }];
    await assertRejects(
      () => assertManagedSectionsFenced([...md, ...yml], templates),
      Error,
      'only supported on Markdown sources — the fence is an HTML comment:\n  - b.yml (label "Y")',
    );
    await assertRejects(
      () => assertManagedSectionsFenced(md, templates),
      Error,
      'managedSection declared but not fenced in the source:\n  - a.md (label "A")',
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
