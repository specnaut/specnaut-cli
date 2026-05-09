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
const OUT_CNAME = `${OUT_DIR}/CNAME`;
const TITLE = "Specflow — documentation";
const REPO_URL = "https://github.com/mkrlabs/specflow";

async function readVersion(denoJsonPath = "deno.json"): Promise<string> {
  const raw = await Deno.readTextFile(denoJsonPath);
  const { version } = JSON.parse(raw) as { version?: string };
  if (!version) throw new Error(`No "version" field in ${denoJsonPath}`);
  return version;
}

/**
 * Fetch the last `count` GitHub releases and render a "Recent releases"
 * Markdown section. On any failure (network, non-2xx, malformed payload),
 * emit a warning to stderr and return an empty string — the docs deploy
 * MUST NOT fail because of a cosmetic section.
 *
 * Public-repo unauthenticated calls have a 60 req/hr ceiling on GitHub
 * runners — sufficient for the build cadence.
 */
export async function fetchRecentReleases(count = 5): Promise<string> {
  const url = `https://api.github.com/repos/mkrlabs/specflow/releases?per_page=${count}`;
  let releases: Array<{ tag_name: string; body: string }>;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      console.warn(
        `::warning::fetchRecentReleases: HTTP ${res.status} from ${url} — skipping section`,
      );
      return "";
    }
    releases = await res.json();
  } catch (err) {
    console.warn(
      `::warning::fetchRecentReleases: ${
        err instanceof Error ? err.message : err
      } — skipping section`,
    );
    return "";
  }
  if (!Array.isArray(releases) || releases.length === 0) return "";

  const lines: string[] = ["## Recent releases", ""];
  for (const r of releases.slice(0, count)) {
    const oneLiner = extractOneLiner(r.body ?? "");
    const tagUrl = `${REPO_URL}/releases/tag/${r.tag_name}`;
    lines.push(`- [${r.tag_name}](${tagUrl}) — ${oneLiner}`);
  }
  return lines.join("\n");
}

/**
 * Extracts a one-liner summary from a `gen-changelog.ts`-style release body.
 * Skips heading lines (`##`, `###`) and the trailing `**Full changelog:**`.
 * Returns the first bullet text, or the first non-empty non-heading line if
 * no bullet is present.
 */
export function extractOneLiner(body: string): string {
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith("**Full changelog")) continue;
    if (line.startsWith("- ")) return line.slice(2).trim();
    return line;
  }
  return "";
}

/**
 * GitHub Pages custom domain. Emitted as `docs-dist/CNAME` so each deploy
 * republishes it; without this, GitHub Pages drops the custom domain on
 * subsequent workflow deploys (build_type=workflow ignores the repo
 * settings UI alone — the artifact's CNAME file is the source of truth).
 *
 * The CNAME on OVH (`specflow → mkrlabs.github.io.`) routes traffic here.
 */
const CUSTOM_DOMAIN = "specflow.makerlabs.dev";

const HTML_TEMPLATE = (body: string, version: string) =>
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${TITLE}</title>
  <meta name="description" content="Specflow — enhanced spec-kit CLI with auto-chained workflow, review phase, and backlog. Distributed as a single native binary." />
  <meta name="specflow-version" content="${version}" />
  <link rel="canonical" href="https://specflow.makerlabs.dev/" />
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
    Specflow <a href="${REPO_URL}/releases/tag/v${version}">v${version}</a>
    · Raw Markdown for LLMs: <a href="./llms.txt">llms.txt</a>
    · Source: <a href="${REPO_URL}">github.com/mkrlabs/specflow</a>
  </footer>
</body>
</html>
`;

export async function buildDocs(opts: {
  source?: string;
  outDir?: string;
  version?: string;
  fetchReleases?: () => Promise<string>;
} = {}): Promise<
  { html: string; markdown: string; version: string; versionJson: string }
> {
  const source = opts.source ?? SOURCE;
  const outDir = opts.outDir ?? OUT_DIR;
  const version = opts.version ?? await readVersion();
  const fetchReleases = opts.fetchReleases ?? (() => fetchRecentReleases());
  const outHtml = `${outDir}/index.html`;
  const outMd = `${outDir}/llms.txt`;
  const outVersionJson = `${outDir}/version.json`;

  const sourceMarkdown = await Deno.readTextFile(source);
  const releaseSection = await fetchReleases();
  const enrichedMarkdown = releaseSection
    ? `${sourceMarkdown}\n\n${releaseSection}\n`
    : sourceMarkdown;
  const rendered = render(enrichedMarkdown, { allowIframes: false });
  const html = HTML_TEMPLATE(rendered, version);
  const markdown = `<!-- Specflow v${version} — ${REPO_URL} -->\n\n${enrichedMarkdown}`;

  // Lightweight machine-readable endpoint consumed by the `specflow-expert`
  // agent to compare the user's installed version against the latest
  // released one. `released_at` is the build timestamp — accurate within
  // the day since static.yml redeploys on every release commit.
  const versionJson = JSON.stringify(
    { version, released_at: new Date().toISOString().split("T")[0] },
    null,
    2,
  ) + "\n";

  await Deno.mkdir(outDir, { recursive: true });
  await Deno.writeTextFile(outHtml, html);
  await Deno.writeTextFile(outMd, markdown);
  await Deno.writeTextFile(`${outDir}/CNAME`, `${CUSTOM_DOMAIN}\n`);
  await Deno.writeTextFile(outVersionJson, versionJson);

  return { html, markdown, version, versionJson };
}

if (import.meta.main) {
  const { html, version } = await buildDocs();
  console.log(`✓ wrote ${OUT_HTML} (${html.length} bytes, v${version})`);
  console.log(`✓ wrote ${OUT_MD}`);
  console.log(`✓ wrote ${OUT_CNAME} (${CUSTOM_DOMAIN})`);
  console.log(`✓ wrote ${OUT_DIR}/version.json (v${version})`);
}
