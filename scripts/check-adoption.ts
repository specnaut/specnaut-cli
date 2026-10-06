#!/usr/bin/env -S deno run --allow-run
// The adoption gate. Every `feat:` / `feat!:` commit in a range must carry an
// `## Agent adoption` section, with a ```prompt block, in its **commit body**.
//
// Why the commit body and not the PR body: `scripts/gen-changelog.ts` reads the
// section back out at release time and prints it under `### Adoption guide`. As
// long as that section lived in a PR body, the whole chain depended on a forge
// round-trip — a feature merged with a local fast-forward has no PR, so its
// guide disappeared from the release notes without a word. The commit travels
// with the change wherever it lands.
//
// Why one script instead of a rule per workflow: the previous gate re-stated
// "what is a feature" in shell inside the PR-only workflow this replaces, while
// `gen-changelog.ts` decided the same question in TypeScript. The two
// definitions drifted, and the laxer one guarded the gate — an entire major
// release's feature set was exempted before anyone noticed. Both CI jobs and
// the local pre-merge check now call this, so there is one definition to drift
// from.
//
// Usage:
//   deno run --allow-run scripts/check-adoption.ts --from <ref> --to <ref>
//   deno run --allow-run scripts/check-adoption.ts            # main..HEAD
//
// Exit 0 = every feature is documented (including "there are no features").
// Exit 1 = at least one is not; each offender is named with its hash.
// Exit 2 = the range could not be read (bad ref, not a git repo).

import { extractAdoption, parseCommitLog } from "./gen-changelog.ts";

/**
 * What counts as a feature. Deliberately identical to the categories
 * `gen-changelog.ts` walks for adoption content (`feat` and `breaking`) — a
 * `feat!:` is a feature that also breaks something, and it is the single
 * commit in a major release most likely to need a guide.
 */
const FEATURE_SUBJECT_RE = /^feat(\([^)]+\))?!?:/;

/**
 * Paths whose contents reach a user project — the binary's own source, the
 * templates `init`/`upgrade` write, and the plugin mirror.
 *
 * A `feat` touching none of them ships nothing anybody installs, which is
 * usually a mistyped `chore`. Usually, not always: `feat(changelog): read the
 * adoption guide from the commit body` changed only `scripts/` and `.github/`
 * and was a genuine feature, because it changed the release notes users read.
 * So this is a prompt for a sentence, not a prohibition — see
 * `REPO_INTERNAL_TRAILER`.
 */
const USER_FACING_PREFIXES = ["src/", "templates/", "plugin/", "mods/"];

/**
 * The escape hatch. A `feat` that ships no user-facing file must say, in one
 * line, why it is still a feature.
 *
 * The rule exists because the gate can push in the wrong direction. A
 * repo-internal script was once committed as `feat`, which made this gate
 * demand an adoption guide, which was then written by inventing a user-facing
 * story — it told an agent to confirm a file "arrived with the upgrade" that
 * is not in the manifest and never arrives. A gate that asks the wrong
 * question gets an answer invented to satisfy it. Requiring the sentence turns
 * that invention into a deliberate claim someone has to write down.
 */
const REPO_INTERNAL_TRAILER = /^Repo-internal:\s*\S+/m;

export type Offender = { hash: string; subject: string; reason: string };

/** Pure core, so the rule is testable without a git repository. */
export function findOffenders(
  commits: { hash: string; subject: string; body?: string; files?: string[] }[],
) {
  const offenders: Offender[] = [];
  for (const c of commits) {
    if (!FEATURE_SUBJECT_RE.test(c.subject.trim())) continue;
    const body = c.body ?? "";

    // `files` is absent when the caller has no diff to offer (the pure unit
    // tests); the scope rule simply does not apply then.
    if (c.files !== undefined) {
      const shipsSomething = c.files.some((f) => USER_FACING_PREFIXES.some((p) => f.startsWith(p)));
      if (!shipsSomething && !REPO_INTERNAL_TRAILER.test(body)) {
        offenders.push({
          hash: c.hash,
          subject: c.subject,
          reason:
            "a `feat` that touches nothing under src/, templates/, plugin/ or mods/ — it ships " +
            "no file any user installs. Use `chore:`, or add a `Repo-internal: <why " +
            "this is still user-facing>` line to the body",
        });
        continue;
      }
    }
    if (!/^## Agent adoption\b/m.test(body)) {
      offenders.push({
        hash: c.hash,
        subject: c.subject,
        reason: "no '## Agent adoption' section",
      });
      continue;
    }
    // `extractAdoption` is the *consumer's* rule, reused verbatim rather than
    // re-derived: a section it would reject is a section the release notes will
    // silently drop, so the gate has to reject exactly the same thing.
    if (extractAdoption(body) === null) {
      offenders.push({
        hash: c.hash,
        subject: c.subject,
        reason: "'## Agent adoption' present but no ```prompt fenced block under it",
      });
    }
  }
  return offenders;
}

/** The paths a commit touches, for the ships-something rule. */
async function filesIn(hash: string): Promise<string[]> {
  const { stdout, success } = await new Deno.Command("git", {
    args: ["show", "--name-only", "--format=", hash],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!success) return [];
  return new TextDecoder().decode(stdout).split("\n").map((l) => l.trim()).filter(Boolean);
}

function parseFlag(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && i < args.length - 1 ? args[i + 1] : null;
}

async function main() {
  const from = parseFlag(Deno.args, "--from") ?? "main";
  const to = parseFlag(Deno.args, "--to") ?? "HEAD";

  const { stdout, stderr, success } = await new Deno.Command("git", {
    args: ["log", `${from}..${to}`, "--format=%h\x1f%s\x1f%b\x1e", "--no-merges"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!success) {
    console.error(`check-adoption: git log ${from}..${to} failed`);
    console.error(new TextDecoder().decode(stderr).trim());
    Deno.exit(2);
  }

  const parsed = parseCommitLog(new TextDecoder().decode(stdout));
  const commits = await Promise.all(parsed.map(async (c) => ({
    ...c,
    files: await filesIn(c.hash),
  })));
  const offenders = findOffenders(commits);
  const features = commits.filter((c) => FEATURE_SUBJECT_RE.test(c.subject.trim()));

  if (offenders.length === 0) {
    console.log(
      `check-adoption: ✓ ${features.length} feature commit(s) in ${from}..${to}, all documented`,
    );
    return;
  }

  console.error(
    `check-adoption: ${offenders.length} feature commit(s) in ${from}..${to} without an adoption guide:\n`,
  );
  for (const o of offenders) {
    console.error(`  ${o.hash}  ${o.subject}`);
    console.error(`             → ${o.reason}\n`);
  }
  console.error(
    "Add the section to the commit body (`git commit --amend`, or fix it during\n" +
      "the squash-by-scope step of `/specnaut merge`). Format and examples:\n" +
      "CONTRIBUTING.md#agent-adoption\n",
  );
  Deno.exit(1);
}

if (import.meta.main) await main();
