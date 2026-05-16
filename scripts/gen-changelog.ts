// Generates a structured Markdown changelog from conventional-commit-style
// messages between two refs. Writes to dist/release-notes.md by default —
// suitable for `softprops/action-gh-release@v2`'s `body_path` input, which
// replaces the noisy auto-generated release notes with a feature-level
// summary.
//
// Pure helpers (`classifyCommit`, `formatChangelog`) are exported for tests.

export type Category = "feat" | "fix" | "chore" | "skip";

export type Commit = {
  hash: string;
  subject: string;
};

export type Classified = Commit & {
  category: Category;
  cleanedSubject: string;
};

const FEATURE_PREFIXES = new Set(["feat"]);
const FIX_PREFIXES = new Set(["fix"]);
const CHORE_PREFIXES = new Set([
  "chore",
  "refactor",
  "docs",
  "test",
  "ci",
  "style",
  "perf",
  "build",
]);
const RELEASE_BUMP_RE = /^chore:\s*release\s+v\d+\.\d+\.\d+/;
const PREFIX_RE = /^(\w+)(\([^)]+\))?!?:\s*(.+)$/;

export function classifyCommit(commit: Commit): Classified {
  const subject = commit.subject.trim();
  if (RELEASE_BUMP_RE.test(subject)) {
    return { ...commit, category: "skip", cleanedSubject: subject };
  }
  const m = subject.match(PREFIX_RE);
  if (!m) {
    return { ...commit, category: "chore", cleanedSubject: capitalize(subject) };
  }
  const type = m[1].toLowerCase();
  const rest = m[3];
  const cleanedSubject = capitalize(rest);
  if (FEATURE_PREFIXES.has(type)) {
    return { ...commit, category: "feat", cleanedSubject };
  }
  if (FIX_PREFIXES.has(type)) {
    return { ...commit, category: "fix", cleanedSubject };
  }
  if (CHORE_PREFIXES.has(type)) {
    return { ...commit, category: "chore", cleanedSubject };
  }
  return { ...commit, category: "chore", cleanedSubject };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const ADOPTION_HEADER_RE = /^## Agent adoption\b/m;
const NEXT_H2_RE = /^## /m;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const PROMPT_FENCE_RE = /^```prompt\s*$/m;

/**
 * Extract the body of the `## Agent adoption` section from a PR body.
 *
 * - Returns the content between `## Agent adoption` and the next `## ` heading
 *   (or EOF), trimmed.
 * - Returns `null` when the section is absent OR when it has no ` ```prompt `
 *   fenced block (a section without a prompt is treated as "incomplete" and
 *   not included in the changelog).
 * - Strips HTML comments — the PR template ships placeholders inside `<!-- -->`
 *   that should never reach the release body.
 */
export function extractAdoption(body: string): string | null {
  const headerMatch = body.match(ADOPTION_HEADER_RE);
  if (!headerMatch) return null;
  const start = (headerMatch.index ?? 0) + headerMatch[0].length;

  const tail = body.slice(start);
  const nextH2 = tail.match(NEXT_H2_RE);
  const section = nextH2 ? tail.slice(0, nextH2.index ?? tail.length) : tail;

  const cleaned = section.replace(HTML_COMMENT_RE, "").trim();
  if (!PROMPT_FENCE_RE.test(cleaned)) return null;
  return cleaned;
}

const PR_NUMBER_RE = /\s\(#(\d+)\)\s*$/;

/**
 * Extract the trailing PR number from a commit subject formatted as
 * `... (#NNN)`. Returns `null` when no match.
 */
export function extractPrNumber(subject: string): number | null {
  const m = subject.match(PR_NUMBER_RE);
  if (!m) return null;
  return parseInt(m[1], 10);
}

const PR_BODY_CACHE = new Map<number, string>();

/**
 * Fetch a PR body via `gh pr view <num> --json body --jq .body`.
 * Cached per process. Returns `""` on any failure (the caller treats empty
 * as "no adoption section"). Cache miss / fetch errors emit a stderr warning
 * but never fail the build — CI lint (Component 1) is the gate.
 */
export async function fetchPrBody(num: number): Promise<string> {
  const cached = PR_BODY_CACHE.get(num);
  if (cached !== undefined) return cached;
  const cmd = new Deno.Command("gh", {
    args: ["pr", "view", String(num), "--json", "body", "--jq", ".body"],
    stdout: "piped",
    stderr: "piped",
  });
  let stdout: Uint8Array;
  let success: boolean;
  try {
    const out = await cmd.output();
    stdout = out.stdout;
    success = out.success;
  } catch (err) {
    // `gh` binary missing or spawn failure — degrade gracefully.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`gen-changelog: cannot run gh CLI (${msg}) — skipping adoption for #${num}`);
    PR_BODY_CACHE.set(num, "");
    return "";
  }
  if (!success) {
    console.warn(`gen-changelog: failed to fetch PR #${num} body — skipping adoption`);
    PR_BODY_CACHE.set(num, "");
    return "";
  }
  const body = new TextDecoder().decode(stdout);
  PR_BODY_CACHE.set(num, body);
  return body;
}

export type AdoptionEntry = {
  prNum: number;
  title: string;
  body: string;
};

export type FormatOpts = {
  fromTag: string | null;
  toTag: string;
  repoUrl?: string;
  adoptionEntries?: AdoptionEntry[];
};

export function formatChangelog(commits: Classified[], opts: FormatOpts): string {
  const features = commits.filter((c) => c.category === "feat");
  const fixes = commits.filter((c) => c.category === "fix");
  const chores = commits.filter((c) => c.category === "chore");

  const sections: string[] = [];
  sections.push(`## What's changed in ${opts.toTag}`);

  if (commits.length === 0) {
    sections.push("_No user-facing changes since the previous release._");
  }

  if (features.length > 0) {
    sections.push("### Features\n\n" + features.map(formatBullet).join("\n"));
  }
  if (fixes.length > 0) {
    sections.push("### Bug fixes\n\n" + fixes.map(formatBullet).join("\n"));
  }
  const adoption = opts.adoptionEntries ?? [];
  if (adoption.length > 0) {
    const intro =
      "These prompts help your AI agent adopt the new features in an existing project. " +
      "Copy them into your harness, or run `@specflow-expert review-upgrade` to be walked " +
      "through automatically.";
    const items = adoption.map((a) => `**#${a.prNum} — ${a.title}**\n\n${a.body}`).join("\n\n");
    sections.push(`### Adoption guide\n\n${intro}\n\n${items}`);
  }
  if (chores.length > 0) {
    const summary = `${chores.length} internal change${chores.length === 1 ? "" : "s"}`;
    sections.push(
      `### Internal / chores\n\n<details>\n<summary>${summary}</summary>\n\n` +
        chores.map(formatBullet).join("\n") +
        "\n\n</details>",
    );
  }
  if (opts.repoUrl && opts.fromTag) {
    sections.push(
      `**Full changelog:** ${opts.repoUrl}/compare/${opts.fromTag}...${opts.toTag}`,
    );
  }
  return sections.join("\n\n") + "\n";
}

function formatBullet(c: Classified): string {
  return `- ${c.cleanedSubject}`;
}

// ---------- I/O (only runs when invoked as main) ----------

const REPO_URL = "https://github.com/mkrlabs/specflow";
const DEFAULT_OUT = "dist/release-notes.md";

async function getCommits(from: string | null, to: string): Promise<Commit[]> {
  const range = from ? `${from}..${to}` : to;
  const cmd = new Deno.Command("git", {
    args: ["log", range, "--format=%h%x09%s", "--no-merges"],
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout, stderr, success } = await cmd.output();
  if (!success) {
    throw new Error(`git log failed: ${new TextDecoder().decode(stderr)}`);
  }
  return new TextDecoder()
    .decode(stdout)
    .split("\n")
    .filter((l) => l.length > 0)
    .map((line) => {
      const tab = line.indexOf("\t");
      return { hash: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
}

async function detectPrevTag(): Promise<string | null> {
  // Closest tag reachable from HEAD^. When the release skill runs, HEAD is
  // the just-committed bump commit and HEAD^ is the previous release.
  const cmd = new Deno.Command("git", {
    args: ["describe", "--tags", "--abbrev=0", "HEAD^"],
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout, success } = await cmd.output();
  if (!success) return null;
  return new TextDecoder().decode(stdout).trim() || null;
}

async function detectCurrentTag(): Promise<string> {
  const raw = await Deno.readTextFile("deno.json");
  const parsed = JSON.parse(raw) as { version: string };
  return `v${parsed.version}`;
}

async function ensureDir(path: string): Promise<void> {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash > 0) {
    await Deno.mkdir(path.slice(0, lastSlash), { recursive: true });
  }
}

function parseFlag(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && i < args.length - 1 ? args[i + 1] : null;
}

async function main() {
  const args = Deno.args;
  const fromArg = parseFlag(args, "--from");
  const toArg = parseFlag(args, "--to");
  const outArg = parseFlag(args, "--out");

  const from = fromArg ?? (await detectPrevTag());
  const to = toArg ?? (await detectCurrentTag());
  const out = outArg ?? DEFAULT_OUT;

  const commits = await getCommits(from, "HEAD");
  const classified = commits
    .map(classifyCommit)
    .filter((c) => c.category !== "skip");

  const adoptionEntries: AdoptionEntry[] = [];
  for (const c of classified) {
    if (c.category !== "feat") continue;
    const prNum = extractPrNumber(c.subject);
    if (prNum === null) continue;
    const prBody = await fetchPrBody(prNum);
    if (prBody === "") continue;
    const adoption = extractAdoption(prBody);
    if (adoption === null) {
      console.warn(
        `gen-changelog: feat commit ${c.hash} (#${prNum}) has no Agent adoption section — skipping`,
      );
      continue;
    }
    // Title = the cleaned subject without the trailing PR ref.
    const title = c.cleanedSubject.replace(/\s\(#\d+\)\s*$/, "");
    adoptionEntries.push({ prNum, title, body: adoption });
  }

  const md = formatChangelog(classified, {
    fromTag: from,
    toTag: to,
    repoUrl: REPO_URL,
    adoptionEntries,
  });

  await ensureDir(out);
  await Deno.writeTextFile(out, md);
  console.log(`✓ wrote ${out}`);
  console.log(`  range: ${from ?? "<root>"}..HEAD (target ${to})`);
  console.log(
    `  commits: ${classified.length} kept (${commits.length - classified.length} skipped)`,
  );
}

if (import.meta.main) await main();
