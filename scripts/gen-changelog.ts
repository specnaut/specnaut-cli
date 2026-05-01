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

export type FormatOpts = {
  fromTag: string | null;
  toTag: string;
  repoUrl?: string;
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

  const md = formatChangelog(classified, {
    fromTag: from,
    toTag: to,
    repoUrl: REPO_URL,
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
