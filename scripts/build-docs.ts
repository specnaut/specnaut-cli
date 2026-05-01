/**
 * Builds the GitHub Pages site from `docs/llms.md`:
 *
 *   docs/llms.md → docs-dist/index.html  (HTML rendering, GFM + embedded CSS)
 *                → docs-dist/llms.txt    (raw markdown copy, llmstxt.org convention)
 *
 * Wired up via `deno task docs:build`. Invoked by the `Deploy static content
 * to Pages` workflow on every push to main.
 */
import { CSS, render } from "@deno/gfm";

const SOURCE = "docs/llms.md";
const OUT_DIR = "docs-dist";
const OUT_HTML = `${OUT_DIR}/index.html`;
const OUT_MD = `${OUT_DIR}/llms.txt`;
const TITLE = "Specflow — documentation";

const HTML_TEMPLATE = (body: string) =>
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${TITLE}</title>
  <meta name="description" content="Specflow — enhanced spec-kit CLI with auto-chain, review phase, and backlog. Distributed as a single native binary." />
  <link rel="canonical" href="https://mkrlabs.github.io/specflow/" />
  <link rel="alternate" type="text/markdown" href="./llms.txt" />
  <style>
    ${CSS}

    body {
      max-width: 880px;
      margin: 0 auto;
      padding: 2rem 1.25rem 4rem;
      color-scheme: light dark;
      background: var(--color-canvas-default);
    }
    .markdown-body {
      box-sizing: border-box;
      min-width: 200px;
      padding: 0;
    }
    @media (max-width: 768px) {
      body { padding: 1rem 0.75rem 3rem; }
    }
    .doc-footer {
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid var(--color-border-muted);
      font-size: 0.875rem;
      color: var(--color-fg-muted);
    }
    .doc-footer a {
      color: inherit;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <main class="markdown-body">
${body}
  </main>
  <footer class="doc-footer">
    Raw Markdown for LLMs: <a href="./llms.txt">llms.txt</a>
    · Source: <a href="https://github.com/mkrlabs/specflow">github.com/mkrlabs/specflow</a>
  </footer>
</body>
</html>
`;

export async function buildDocs(opts: {
  source?: string;
  outDir?: string;
} = {}): Promise<{ html: string; markdown: string }> {
  const source = opts.source ?? SOURCE;
  const outDir = opts.outDir ?? OUT_DIR;
  const outHtml = `${outDir}/index.html`;
  const outMd = `${outDir}/llms.txt`;

  const markdown = await Deno.readTextFile(source);
  const rendered = render(markdown, { allowIframes: false });
  const html = HTML_TEMPLATE(rendered);

  await Deno.mkdir(outDir, { recursive: true });
  await Deno.writeTextFile(outHtml, html);
  await Deno.writeTextFile(outMd, markdown);

  return { html, markdown };
}

if (import.meta.main) {
  const { html } = await buildDocs();
  console.log(`✓ wrote ${OUT_HTML} (${html.length} bytes)`);
  console.log(`✓ wrote ${OUT_MD}`);
}
