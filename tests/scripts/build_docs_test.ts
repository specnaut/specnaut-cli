import { assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { join } from "@std/path";
import { buildDocs, copyLandingSite, extractOneLiner } from "../../scripts/build-docs.ts";

// All tests pass a `fetchReleases` stub by default so the build is
// hermetic — the real `fetchRecentReleases()` would hit the GitHub
// Releases API.
const noReleases = () => Promise.resolve("");

// Most tests don't exercise the landing copy; point at a missing directory
// so `copyLandingSite` cleanly no-ops and tests stay focused on the docs
// render.
const NO_SITE_DIR = "/tmp/specflow-test-nonexistent-site-__do-not-create__";

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

Deno.test("buildDocs writes docs/index.html and llms.txt with rendered markdown", async () => {
  const md = "# Hello Specflow\n\nThis is a **test** doc.\n";
  await withTempSource(md, async (source, outDir) => {
    await buildDocs({
      source,
      outDir,
      siteDir: NO_SITE_DIR,
      version: "9.9.9",
      fetchReleases: noReleases,
    });

    // Rendered docs now live one level deeper so the `/` path can serve the
    // pixel-art landing.
    assertEquals(await exists(join(outDir, "docs", "index.html")), true);
    assertEquals(await exists(join(outDir, "llms.txt")), true);
    assertEquals(await exists(join(outDir, "CNAME")), true);
    assertEquals(await exists(join(outDir, "version.json")), true);

    const versionJson = JSON.parse(
      await Deno.readTextFile(join(outDir, "version.json")),
    );
    assertEquals(versionJson.version, "9.9.9");
    assertEquals(typeof versionJson.released_at, "string");
    assertEquals(/^\d{4}-\d{2}-\d{2}$/.test(versionJson.released_at), true);

    const html = await Deno.readTextFile(join(outDir, "docs", "index.html"));
    assertStringIncludes(html, "<h1");
    assertStringIncludes(html, "Hello Specflow");
    assertStringIncludes(html, "<strong>test</strong>");
    assertStringIncludes(html, "<!DOCTYPE html>");
    // Raw-markdown alt link is absolute now since the docs HTML moved to /docs/.
    assertStringIncludes(html, 'href="/llms.txt"');
    // Canonical URL points at the new docs location.
    assertStringIncludes(html, 'href="https://specflow.makerlabs.dev/docs/"');
    // Docs page consumes the shared design-system stylesheet — no
    // @deno/gfm CSS embedded inline anymore.
    assertStringIncludes(html, 'href="/styles.css"');
    // Version surfaced in footer + meta tag so users can tell which Specflow
    // release the docs describe.
    assertStringIncludes(html, '<meta name="specflow-version" content="9.9.9"');
    assertStringIncludes(html, "v9.9.9");

    const txt = await Deno.readTextFile(join(outDir, "llms.txt"));
    assertStringIncludes(txt, "<!-- Specflow v9.9.9");
    assertStringIncludes(txt, md, "llms.txt must include the source markdown verbatim");

    // CNAME is emitted on every build so the custom-domain config persists
    // across workflow deploys.
    const cname = await Deno.readTextFile(join(outDir, "CNAME"));
    assertEquals(cname.trim(), "specflow.makerlabs.dev");
  });
});

Deno.test("buildDocs reads version from deno.json by default", async () => {
  const md = "# Hello\n";
  await withTempSource(md, async (source, outDir) => {
    const result = await buildDocs({
      source,
      outDir,
      siteDir: NO_SITE_DIR,
      fetchReleases: noReleases,
    });
    const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
    assertEquals(result.version, denoJson.version);
    assertStringIncludes(result.html, `v${denoJson.version}`);
    assertStringIncludes(result.markdown, `<!-- Specflow v${denoJson.version}`);
  });
});

Deno.test("buildDocs renders the actual Specflow docs without error", async () => {
  const root = await Deno.makeTempDir({ prefix: "specflow-build-docs-real-" });
  try {
    const result = await buildDocs({
      source: "docs/llms.md",
      siteDir: NO_SITE_DIR,
      outDir: root,
      version: "9.9.9",
      fetchReleases: noReleases,
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

Deno.test("buildDocs copies docs/site/ landing into outDir with version substitution", async () => {
  const md = "# Doc body\n";
  const root = await Deno.makeTempDir({ prefix: "specflow-build-docs-site-" });
  try {
    const source = join(root, "input.md");
    await Deno.writeTextFile(source, md);
    const siteDir = join(root, "site");
    await Deno.mkdir(join(siteDir, "assets"), { recursive: true });
    await Deno.writeTextFile(
      join(siteDir, "index.html"),
      `<!DOCTYPE html><html><body>v__SPECFLOW_VERSION__</body></html>\n`,
    );
    await Deno.writeTextFile(join(siteDir, "styles.css"), "body{color:red;}\n");
    await Deno.writeTextFile(join(siteDir, "assets", "x.txt"), "binary-stand-in");

    const outDir = join(root, "out");
    const result = await buildDocs({
      source,
      siteDir,
      outDir,
      version: "9.9.9",
      fetchReleases: noReleases,
    });

    // Landing reaches /, with version substituted.
    assertEquals(await exists(join(outDir, "index.html")), true);
    const landing = await Deno.readTextFile(join(outDir, "index.html"));
    assertStringIncludes(landing, "v9.9.9");
    assertEquals(landing.includes("__SPECFLOW_VERSION__"), false);

    // Non-HTML files are copied verbatim.
    assertEquals(
      await Deno.readTextFile(join(outDir, "styles.css")),
      "body{color:red;}\n",
    );
    assertEquals(
      await Deno.readTextFile(join(outDir, "assets", "x.txt")),
      "binary-stand-in",
    );

    // Docs render still lands at /docs/index.html (not shadowed by the landing).
    assertEquals(await exists(join(outDir, "docs", "index.html")), true);

    // Reported list of copied files matches what we wrote.
    assertEquals(result.siteFiles.length, 3);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("copyLandingSite is a no-op when siteDir does not exist", async () => {
  const root = await Deno.makeTempDir({ prefix: "specflow-copy-landing-" });
  try {
    const written = await copyLandingSite(NO_SITE_DIR, root, "9.9.9");
    assertEquals(written.length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("buildDocs appends Recent releases section when fetchReleases returns content", async () => {
  const md = "# Doc\n";
  const stub = () =>
    Promise.resolve([
      "## Recent releases",
      "",
      "- [v1.1.13](https://github.com/mkrlabs/specflow/releases/tag/v1.1.13) — Lift disable-model-invocation on /specflow router (#167)",
      "- [v1.1.12](https://github.com/mkrlabs/specflow/releases/tag/v1.1.12) — Bundle a specflow-expert agent across all 8 harnesses",
    ].join("\n"));
  await withTempSource(md, async (source, outDir) => {
    const result = await buildDocs({
      source,
      outDir,
      siteDir: NO_SITE_DIR,
      version: "9.9.9",
      fetchReleases: stub,
    });
    assertStringIncludes(result.markdown, "## Recent releases");
    assertStringIncludes(result.markdown, "[v1.1.13](https://github.com");
    assertStringIncludes(result.html, "Recent releases");
    const txt = await Deno.readTextFile(join(outDir, "llms.txt"));
    assertStringIncludes(txt, "Recent releases");
  });
});

Deno.test("buildDocs omits Recent releases section when fetchReleases returns empty string", async () => {
  const md = "# Only doc\n";
  await withTempSource(md, async (source, outDir) => {
    const result = await buildDocs({
      source,
      outDir,
      siteDir: NO_SITE_DIR,
      version: "9.9.9",
      fetchReleases: noReleases,
    });
    assertEquals(result.markdown.includes("Recent releases"), false);
  });
});

Deno.test("extractOneLiner picks first bullet, skipping headings and footer", () => {
  const body = `## What's changed in v1.1.13

### Bug fixes

- Lift disable-model-invocation on /specflow router (#167)

**Full changelog:** https://github.com/mkrlabs/specflow/compare/v1.1.12...v1.1.13`;
  assertEquals(
    extractOneLiner(body),
    "Lift disable-model-invocation on /specflow router (#167)",
  );
});

Deno.test("extractOneLiner returns first non-heading line when no bullet", () => {
  const body = `## v0.1.0

Initial release.

- bullet that comes after`;
  assertEquals(extractOneLiner(body), "Initial release.");
});

Deno.test("extractOneLiner returns empty string for empty body", () => {
  assertEquals(extractOneLiner(""), "");
});
