import { assertEquals } from "@std/assert";
import {
  git,
  HARNESSES,
  makeRepo,
  pool,
  type RepoOptions,
  type Sandbox,
  sandbox,
} from "./hook_sandbox.ts";
import { bash, GATED, verdict } from "./guard_merge_fixture.ts";

/**
 * US1 / FR-001, FR-016, FR-017, D3 — under `merge: manual`, nothing lands on
 * the base branch without the user. One case per landing form, each run on
 * Claude and on Codex: denied unless this turn's prompt approved it (spec 048
 * § 8 — Claude's own ask comes only after that). SC-002: a stamp from a
 * previous turn does not count — how a gated landing resolves is
 * guard_merge_approval_test.ts.
 */

/** [repo shape, command, gated?] — repo shapes are built once per test. */
const FORMS: ReadonlyArray<[shape: string, command: string, gated: boolean]> = [
  // git merge / git pull
  ["onMain", "git merge --ff-only feat", true],
  ["onMain", "git pull", true],
  ["onFeat", "git checkout main && git merge --ff-only feat", true],
  ["onFeat", "git switch main; git merge feat", true],
  ["onFeat", "git merge main", false],
  ["onFeat", "git pull --rebase", false],
  ["onFeat", "git -C ../elsewhere merge feat", true],
  // git push: an allow list
  ["onFeat", "git push", true],
  ["onFeat", "git push origin", true],
  ["onFeat", "git push origin main", true],
  ["onFeat", "git push origin HEAD:main", true],
  ["onFeat", "git push origin feat:refs/heads/main", true],
  ["onFeat", "git push origin +feat:main", true],
  ["onFeat", "git push origin :main", true],
  ["onFeat", "git push --all origin", true],
  ["onFeat", "git push --mirror origin", true],
  ["onFeat", "git push origin --delete feat", true],
  ["onFeat", "git push origin 'refs/heads/*:refs/heads/*'", true],
  ["onFeat", "git push --frobnicate origin feat", true],
  ["onMain", "git push origin HEAD", true],
  ["onFeat", "git push origin feat", false],
  ["onFeat", "git push -u origin feat", false],
  ["onFeat", "git push --force-with-lease origin feat:feat", false],
  ["onFeat", "git push origin HEAD", false],
  ["onFeat", "git push --tags origin", false],
  // a refspec the shell expands is not explicit: what it names is unknown here
  ["onFeat", 'BASE=main; git push origin "$BASE"', true],
  ["onFeat", 'git push origin HEAD:"$B"', true],
  ["onFeat", "git push origin ${B}", true],
  ["onFeat", "git push origin $(git branch --show-current)", true],
  ["onFeat", "git push origin fe?t", true],
  ["onFeat", "git push origin 'feat'", false],
  ["onFeat", 'git push origin "feat:feat"', false],
  // repo moved
  ["onFeat", "cd ../elsewhere && git push origin feat", true],
  ["onFeat", "GIT_DIR=/elsewhere/.git git push origin feat", true],
  ["onFeat", "git --git-dir=/elsewhere/.git push origin feat", true],
  ["onFeat", "export GIT_DIR=/elsewhere/.git; git push origin feat", true],
  ["onFeat", "env -C ../elsewhere git push origin feat", true],
  // separators, wrappers, global options, sh -c
  ["onFeat", "echo ok; git push origin main", true],
  ["onFeat", "true && git push origin main", true],
  ["onFeat", "false || git push origin main", true],
  ["onFeat", "echo x | git push origin main", true],
  ["onFeat", "git status\ngit push origin main", true],
  ["onFeat", "echo $(git push origin main)", true],
  ["onFeat", 'echo "pushed: $(git push origin main)"', true],
  ["onFeat", "echo `git push origin main`", true],
  ["onFeat", "(git push origin main)", true],
  ["onFeat", "FOO=1 git push origin main", true],
  ["onFeat", "env FOO=1 git push origin main", true],
  ["onFeat", "sudo -u dev git push origin main", true],
  ["onFeat", "command git push origin main", true],
  ["onFeat", "/usr/bin/git push origin main", true],
  ["onFeat", "git --no-pager -c color.ui=never push origin main", true],
  ["onFeat", "git -c alias.p=push p origin feat", true],
  ["onFeat", "git push origin main >/dev/null 2>&1", true],
  ["onFeat", "bash -lc 'git push origin main'", true],
  ["onFeat", 'sh -c "git push origin main"', true],
  ["onFeat", "bash -c 'bash -c \"git status\"'", true],
  ["onFeat", "eval 'git push origin main'", true],
  ["onFeat", "echo 'git push origin main' | bash", true],
  ["onFeat", "bash -o pipefail -c 'git push origin main'", true],
  // forges
  ["onFeat", "gh pr merge 12 --squash", true],
  ["onFeat", "glab mr merge 12", true],
  ["onFeat", "gh -R acme/app pr merge 12", true],
  ["onFeat", "gh --repo acme/app pr merge 12", true],
  ["onFeat", "gh --repo=acme/app pr merge 12", true],
  ["onFeat", "gh pr view 12", false],
  ["onFeat", "gh -R acme/app pr view 12", false],
  // git aliases
  ["onFeat", "git ship", true],
  ["onFeat", "git yolo", true],
  ["onFeat", "git st", false],
  // text that merely contains a landing
  ["onFeat", "git status", false],
  ["onFeat", "ls -la", false],
  ["onFeat", "echo 'git push origin main'", false],
  ["onFeat", 'git commit -m "then git push origin main"', false],
  ["onFeat", "git commit -F - <<'EOF'\ngit push origin main\nEOF\ngit log -1", false],
  ["onFeat", "# git push origin main", false],
  ["onFeat", "git status # && git push origin main", false],
  // a herestring and arithmetic shifts open no heredoc
  ["onFeat", "cat <<< x\ngit push origin main", true],
  ["onFeat", "cat <<<x; git log\ngit push origin main", true],
  ["onFeat", "echo $((1<<3))\ngit push origin main", true],
  ["onFeat", 'echo "$((1<<3))"\ngit push origin main', true],
  ["onFeat", "((a<<b))\ngit push origin main", true],
  ["onFeat", "cat <<< x\ngit status", false],
  ["onFeat", "echo $((1<<3)) && git status", false],
  ["onFeat", "git log -n $(( (1+1) << 2 ))", false],
  ["onFeat", "git commit -m \"$(cat <<'EOF'\nfeat: x\n\ngit push origin main\nEOF\n)\"", false],
  // a line that does not parse is gated, never guessed at
  ["onFeat", 'echo "unterminated\ngit push origin main', true],
  ["onFeat", "echo 'unterminated\ngit push origin main", true],
  ["onFeat", "echo $(git status", true],
  ["onFeat", "echo `git status", true],
  ["onFeat", "cat <<EOF", true],
  ["onFeat", "cat <<EOF\ngit push origin main", true],
  // unknown base: every landing form is gated
  ["noBase", "git push origin feat", true],
  ["noBase", "git merge main", true],
  ["noBase", "git status", false],
  // the file says auto, or nothing: the guard is inert
  ["auto", "git push origin main", false],
  ["noFile", "git push origin main", false],
];

const SHAPES: Record<string, RepoOptions> = {
  onMain: { head: "main" },
  onFeat: { head: "feat" },
  noBase: { head: "feat", base: null },
  auto: { head: "feat", mode: "auto" },
  noFile: { head: "feat", mode: null },
};

async function repos(sb: Sandbox): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, opts] of Object.entries(SHAPES)) out[name] = await makeRepo(sb, opts);
  for (const repo of Object.values(out)) {
    await git(sb, repo, "config", "alias.ship", "push origin main");
    await git(sb, repo, "config", "alias.yolo", "!git push origin main");
    await git(sb, repo, "config", "alias.st", "status --short");
  }
  return out;
}

Deno.test("guard-merge: every landing form, on Claude and on Codex", async () => {
  const sb = await sandbox();
  try {
    const shapes = await repos(sb);
    const cases = HARNESSES.flatMap((harness) => FORMS.map((form) => [harness, ...form] as const));
    const got = await pool(
      cases,
      ([harness, shape, command]) => bash(sb, harness, shapes[shape], command),
    );
    const wrong = cases.flatMap(([harness, shape, command, gated], i) => {
      const want = gated ? GATED[harness] : "allow";
      const v = verdict(got[i]);
      return v === want ? [] : [
        `${harness} [${shape}] ${JSON.stringify(command)}: want ${want}, got ${v} ${got[i].stderr}`,
      ];
    });
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});
