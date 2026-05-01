import { assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { join } from "@std/path";
import { buildDocs } from "../../scripts/build-docs.ts";

async function withTempSource(
  markdown: string,
  fn: (source: string, outDir: string) => Promise<void>,
) {
  const root = await Deno.makeTempDir({ prefix: "specflow-build-docs-" });
  try {
    const source = join(root, "input.md");
    const outDir = join(root, "out");
    await Deno.writeTextFile(source, markdown);
    await fn(source, outDir);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("buildDocs writes index.html and llms.txt with rendered markdown", async () => {
  const md = "# Hello Specflow\n\nThis is a **test** doc.\n";
  await withTempSource(md, async (source, outDir) => {
    await buildDocs({ source, outDir });

    assertEquals(await exists(join(outDir, "index.html")), true);
    assertEquals(await exists(join(outDir, "llms.txt")), true);
    assertEquals(await exists(join(outDir, "CNAME")), true);

    const html = await Deno.readTextFile(join(outDir, "index.html"));
    assertStringIncludes(html, "<h1");
    assertStringIncludes(html, "Hello Specflow");
    assertStringIncludes(html, "<strong>test</strong>");
    assertStringIncludes(html, "<!DOCTYPE html>");
    // Raw-markdown alt link is present.
    assertStringIncludes(html, 'href="./llms.txt"');

    const txt = await Deno.readTextFile(join(outDir, "llms.txt"));
    assertEquals(txt, md, "llms.txt must be a verbatim copy of the source markdown");

    // CNAME is emitted on every build so the custom-domain config persists
    // across workflow deploys.
    const cname = await Deno.readTextFile(join(outDir, "CNAME"));
    assertEquals(cname.trim(), "specflow.makerlabs.dev");
  });
});

Deno.test("buildDocs renders the actual Specflow docs without error", async () => {
  const root = await Deno.makeTempDir({ prefix: "specflow-build-docs-real-" });
  try {
    const result = await buildDocs({
      source: "docs/llms.md",
      outDir: root,
    });
    // Sanity: the real docs mention install + harnesses, which are headline
    // sections that should never disappear silently.
    assertStringIncludes(result.markdown, "## Install");
    assertStringIncludes(result.markdown, "harnesses");
    assertStringIncludes(result.html, "Install");
    assertStringIncludes(result.html, "harnesses");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
