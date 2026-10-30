import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  approve,
  git,
  HOOKS_DIR,
  makeRepo,
  payload,
  pool,
  type Run,
  runHook,
  type Sandbox,
  sandbox,
} from "./hook_sandbox.ts";
import { pathWithoutJq } from "./hook_path.ts";

/**
 * US5 / FR-006 — on Codex, every command in release-commands.txt, and any
 * push of a tag ref, is refused unless the user's own prompt this turn
 * approved a release. `--no-push` exempts only its own command segment. On
 * Claude the guard is inert: `permissions.ask` holds the same list.
 */

async function bash(
  sb: Sandbox,
  repo: string,
  command: string,
  extra: Record<string, unknown> = {},
) {
  const p = await payload("codex", "pre_tool_use_bash", {
    cwd: repo,
    tool_input: { command },
    ...extra,
  });
  return runHook(sb, "guard-release.sh", "codex", p);
}

/**
 * Denied, and by the release rule: approval_gate's refusal. A crash exits 2
 * too, so the exit code alone would read every crash as a deny (cli#711).
 */
const DENY = /^specnaut guard-release: .+ publishes a release, .+ To let it through, reply /;
const denied = (r: Run) => r.code === 2 && DENY.test(r.stderr);

const CASES: ReadonlyArray<[command: string, denied: boolean]> = [
  // the release scripts, however they are reached
  [".claude/skills/ship/scripts/tag.sh --bump minor", true],
  ["bash .agents/skills/ship/scripts/tag.sh", true],
  ["tag.sh --no-push && git push origin v1.2.3", true],
  ["tag.sh --no-push", false],
  ["tag.sh --no-push; release-github.sh v1.2.3", true],
  ["release-github.sh v1.2.3", true],
  ["./release-gitlab.sh v1.2.3", true],
  ["timeout 600 bash .claude/skills/ship/scripts/release-github.sh v1.2.3", true],
  ['"" ; gh release list', false],
  // spelled in another case, or as a word the shell rewrites (_listed.sh)
  ["Release-GitHub.sh v1.2.3", true],
  ['"$S" v1.2.3', true],
  ["./release-*.sh v1.2.3", true],
  ["ls *.sh", false],
  ['git commit -m "$(cat a) and $(cat b)"', false],
  ['echo "built $(git rev-parse --short HEAD) at $(date)"', false],
  ['"$(echo tag.sh)" --bump minor', true],
  // the publishing commands themselves (§ 11 F4)
  ["gh release create v1.2.3 --notes x", true],
  ["gh release edit v1.2.3 --draft=false", true],
  ["gh release upload v1.2.3 dist/app.tar.gz", true],
  ["glab release create v1.2.3", true],
  ["gh run rerun 123", true],
  ["bash -lc 'gh release create v1.2.3'", true],
  ["cd dist && gh release upload v1 a.tgz", true],
  ["gh -R acme/app release create v1.2.3", true],
  ["gh --repo acme/app release upload v1 a.tgz", true],
  ["gh --repo=acme/app release edit v1 --draft=false", true],
  ["glab -R acme/app release create v1", true],
  ["gh -R acme/app release view v1", false],
  // a line too nested to read is gated, never guessed at
  [`bash -c "bash -c 'gh release create v1'"`, true],
  ["eval 'gh release create v1'", true],
  ["echo 'gh release create v1' | bash", true],
  ["gh release view v1.2.3", false],
  ["gh release list", false],
  ["gh run list", false],
  ["echo gh release create v1", false],
  // a word the shell or the command fills in, at a listed position (cli#711)
  ["gh $(echo release) create v1", true],
  ['gh release "$S" v1', true],
  ['gh "$X" create v1', true],
  ["echo release create v1 | xargs gh", true],
  ["find release -maxdepth 0 -exec gh {} create v1 \\;", true],
  ["gh release new v1", true],
  ["gh $W v1", true], // W="release create": an unquoted word may be several
  ['gh release view "$T"', false],
  ["echo v1 | xargs gh release view", false],
  // a git subcommand it cannot read: rewritten by the shell, or an alias it cannot follow
  ["git $(echo push) origin v1.0.0", true],
  ['git "$P" origin v1.0.0', true],
  ["git -c alias.p=push p origin v1.0.0", true],
  ["git pt", true],
  ["git st", false],
  // tag pushes
  ["git push --tags", true],
  ["git push origin feat --follow-tags", true],
  ["git push origin refs/tags/v1.0.0", true],
  ["git push origin v1.0.0", true],
  ["git push origin tag v2.0.0", true],
  ["git push origin +v1.0.0:refs/tags/v1.0.0", true],
  ["git tag v9.0.0 && git push origin v9.0.0", true],
  ["git -C . push --mirror origin", true],
  ["git push origin feat", false],
  ["git push -u origin brand-new-branch", false],
  ["git tag v1.2.3", false],
  ["git status", false],
];

Deno.test("guard-release on Codex: every listed command and every tag push", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto", head: "feat" });
    await git(sb, repo, "tag", "v1.0.0");
    await git(sb, repo, "config", "alias.pt", "!git push --tags");
    await git(sb, repo, "config", "alias.st", "status --short");
    const runs = await pool(CASES, ([command]) => bash(sb, repo, command));
    // An allow is silent: an error inside the matcher once printed "refusing"
    // and exited 0 — a crash read as "not listed".
    const wrong = CASES.flatMap(([command, deny], i) =>
      (deny ? denied(runs[i]) : runs[i].code === 0 && runs[i].stderr === "") ? [] : [
        `${JSON.stringify(command)}: want ${deny ? "deny" : 0}, got ${runs[i].code} ${
          runs[i].stderr
        }`,
      ]
    );
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});

Deno.test("guard-release: push.followTags makes every push a tag push", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto", head: "feat" });
    await git(sb, repo, "config", "push.followTags", "true");
    assertEquals(denied(await bash(sb, repo, "git push origin feat")), true);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("guard-release: only this turn's release approval lets it through", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto", head: "feat" });
    const publish = (extra: Record<string, unknown> = {}) =>
      bash(sb, repo, "gh release create v1.2.3", extra);
    const refused = await publish();
    assert(denied(refused), refused.stderr);
    assertStringIncludes(refused.stderr, "`release it`");

    await approve(sb, "codex", repo, "release it");
    assertEquals((await publish()).code, 0);
    assertEquals(
      (await bash(sb, repo, "tag.sh && git push --tags")).code,
      0,
      "the approval covers the turn",
    );
    assertEquals(
      denied(await publish({ turn_id: "019a2b3c-ffff-7000-8000-000000000002" })),
      true,
      "a previous turn",
    );

    await approve(sb, "codex", repo, "merge");
    assertEquals(denied(await publish()), true, "a merge approval is not a release approval");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("guard-release is inert on Claude, even without jq: permissions.ask holds the list there", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto" });
    const p = await payload("claude", "pre_tool_use_bash", {
      cwd: repo,
      tool_input: { command: "gh release create v1" },
    });
    assertEquals((await runHook(sb, "guard-release.sh", "claude", p)).code, 0);
    const noJq = await pathWithoutJq(sb);
    assertEquals(
      (await runHook(sb, "guard-release.sh", "claude", p, { env: { PATH: noJq } })).code,
      0,
    );
  } finally {
    await sb.cleanup();
  }
});

/**
 * F4 — the Codex list and Claude's `permissions.ask` rules are one list on
 * two harnesses.
 */
Deno.test({
  name: "Claude's permissions.ask rules cover every command in release-commands.txt (F4)",
  fn: async () => {
    const settings = JSON.parse(
      await Deno.readTextFile(
        join(HOOKS_DIR, "..", "..", "claude", "settings.json"),
      ),
    );
    const rules: string[] = settings.permissions.ask;
    const list = (await Deno.readTextFile(join(HOOKS_DIR, "release-commands.txt")))
      .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
      .map((l) => l.split(/\s+except\s+/)[0]);
    const missing = list.filter((cmd) =>
      cmd.endsWith(".sh")
        ? !rules.some((r) => r.includes(cmd))
        : !rules.includes(`Bash(${cmd} *)`) && !rules.includes(`Bash(${cmd}*)`)
    );
    assertEquals(missing, [], "commands Codex gates but Claude does not ask about");
    assert(list.length > 0);
  },
});
