import { assert } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * The guards `/ship`, `/task backlog` and `/task groom` may not lose to a trim
 * (cli#679, plan 044 FR-008).
 *
 * FR-003 verifies a trim by diffing every script invocation and step heading
 * before and after. That diff cannot see a guard written as a sentence — "do
 * not stash", "never only move to Done" — and those are exactly the lines a
 * tutorial cut removes first, because they sit inside the explanatory prose.
 * So each one is pinned here, in the file that now carries it.
 *
 * Read from `templates/core/` (the source); `plugin_sync_test.ts` holds the
 * plugin mirror byte-identical and `gen-bundle --check` holds the bundle, so a
 * second read of either would only restate those locks.
 *
 * Whitespace is normalised before matching: the sentences are line-wrapped,
 * and a lock that broke on a re-wrap would invite shortening the fragment
 * until it guards a keyword instead of a rule.
 */

const SKILLS = fromFileUrl(new URL("../../templates/core/skills/", import.meta.url));
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const read = (rel: string) => flat(Deno.readTextFileSync(`${SKILLS}${rel}`));

/** One backend's block of `task/backlog.md`, so a rule is pinned per backend. */
function backend(name: string): string {
  const raw = Deno.readTextFileSync(`${SKILLS}task/backlog.md`);
  const begin = raw.indexOf(`<!-- BEGIN: backend=${name} -->`);
  const end = raw.indexOf(`<!-- END: backend=${name} -->`);
  assert(begin >= 0 && end > begin, `task/backlog.md has no well-formed ${name} block`);
  return flat(raw.slice(begin, end));
}

const KEEP: ReadonlyArray<{ file: string; body: () => string; sentences: readonly string[] }> = [
  {
    file: "ship/SKILL.md",
    body: () => read("ship/SKILL.md"),
    sentences: [
      // Step 4 — the one stop before an act that cannot be taken back.
      "## Step 4 — confirm before the irreversible act",
      "**A tag push and a release publish are irreversible and outward-facing.**",
      'Ask once, as a concrete proposal — **"I\'m about to push `<tag>` to `<remote>` — OK?"** — never as an open question.',
      // Step 1 — the dirty tree.
      "**Is the tree dirty?** If so, say what is uncommitted and stop. Do not stash, do not commit on the user's behalf, and do not tag a tree that does not match what will be built.",
    ],
  },
  {
    file: "ship/phases/release.md",
    body: () => read("ship/phases/release.md"),
    sentences: [
      "`ask` beats `allow`, so a broad `gh release *` you add to run `/ship` unattended still stops at the one step you cannot take back.",
      "Run release publication without showing the user the generated body first when invoked interactively",
      // The deploy recipe: least privilege and per-step secrets.
      "**The rule: production deploys are triggered ONLY by a published release — never by a push to your default branch.**",
      "# Least privilege: the deploy authenticates to your provider via secrets, # not the GITHUB_TOKEN. Grant nothing it doesn't need. permissions: contents: read",
      "DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }} # secrets only on the step that needs them",
      "with: { persist-credentials: false }",
      "if: github.repository == 'OWNER/REPO' # a fork that copied this can't deploy your prod",
    ],
  },
  {
    file: "ship/phases/tag.md",
    body: () => read("ship/phases/tag.md"),
    sentences: [
      "Do NOT run it automatically — releasing is an explicit, deliberate user action.",
    ],
  },
  ...["github", "gitlab"].map((b) => ({
    file: `task/backlog.md (backend=${b})`,
    body: () => backend(b),
    sentences: [
      "**Closing** — close the issue (don't just move to Done). The repo's issue history is the audit trail.",
    ],
  })),
  {
    file: "task/backlog.md (backend=cloud)",
    body: () => backend("cloud"),
    sentences: [
      "**No token is stored here.** `specnaut cloud login` keeps credentials in the OS keychain (or a `0600` file under `~/.specnaut`)",
    ],
  },
  {
    file: "task/groom.md",
    body: () => read("task/groom.md"),
    sentences: [
      "**Read-only — report, never move.**",
      "Read-only, like the two checks above: never delete or modify a spec file.",
      "Do not close autonomously.",
    ],
  },
];

for (const { file, body, sentences } of KEEP) {
  Deno.test(`${file} keeps every FR-008 guard`, () => {
    const content = body();
    for (const sentence of sentences) {
      assert(
        content.includes(flat(sentence)),
        `${file} no longer carries:\n  ${flat(sentence)}\n` +
          `A guard is not tutorial prose — see plan 044 FR-008.`,
      );
    }
  });
}
