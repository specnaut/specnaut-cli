import { assertEquals } from "@std/assert";
import {
  approve,
  git,
  type Harness,
  HARNESSES,
  makeRepo,
  payload,
  pool,
  runHook,
  sandbox,
} from "./hook_sandbox.ts";
import { bash as mergeBash, GATED, verdict as mergeVerdict } from "./guard_merge_fixture.ts";
import { C, HOOK, project, SELF, verdict as constitutionVerdict } from "./constitution_fixture.ts";

/**
 * The guards stop an agent acting by mistake, and a guard that fires on
 * ordinary work teaches people to type the approval word to get unblocked. Each
 * row names the line that used to fire and its neighbour that must still.
 */

const HEREDOC_DATE = "cat >f <<EOF\nsome prose\n`date`\nEOF";

// [line, held] under `merge: manual`.
const LANDINGS: ReadonlyArray<[string, boolean]> = [
  // an unreadable line is held only when it names what is gated
  ['eval "$X"', false],
  ['eval "git push"', true],
  ["eval 'gh pr merge 1'", true],
  ["echo $(case x in a) git push origin main;; esac)", true],
  ['eval "$X" https://github.com/legit/.git', false],
  // an unquoted heredoc body is what bash reads: a "…" that runs its substitutions
  [HEREDOC_DATE, false],
  ["cat >f <<EOF\nprose\n`git push`\nEOF", true],
  ["cat >f <<EOF\n$(\ngit push\n)\nEOF", true],
  ['cat >f <<EOF\nsay "git push" here, no substitution\nEOF', false],
  // a `"` in the body's text is literal, and a real one inside a substitution
  // still quotes: the `'` must not open, the `)` must not close
  ['cat >f <<EOF\n$(git commit -m "it\'s" && git push origin main; echo "it\'s")\nEOF', true],
  ['cat >f <<EOF\n$(echo "done :)" && git push origin main)\nEOF', true],
  ['cat >f <<EOF\n$(bash "land-feature.sh")\nEOF', true],
  ["cat >f <<EOF\n\\\"don't $(git push) won't\\\"\nEOF", true],
  ["cat >f <<EOF\n\" it's git prose `date`\nEOF", false],
  ['cat >f <<EOF\n" ; git push origin main `date`\nEOF', false],
  // a quoted delimiter: nothing in the body runs
  ["cat >f <<'EOF'\n$(git push)\nEOF", false],
  ['cat >f <<EOF\nquote " and `date`\nEOF', false],
  // a command word that is only named variables
  ["for t in a b; do bash scripts/$t.sh; done", false],
  ["for t in land-feature b; do bash scripts/$t.sh; done", true],
  ['for s in scripts/*.sh; do bash "$s"; done', true],
  ['GIT="git -C x"; $GIT push origin main', true],
  ['G=git; "$G" push origin main', true],
  ["$(echo land-feature.sh)", true],
  ['for s in `ls scripts`; do bash "$s"; done', true],
  ['ls scripts/*.sh | while read s; do bash "$s"; done', true],
  ["*.sh", true],
];

Deno.test("guard-merge holds what names a landing, and only that", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { head: "main" });
    const cases = HARNESSES.flatMap((h) => LANDINGS.map(([c, held]) => [h, c, held] as const));
    const got = await pool(cases, ([h, c]) => mergeBash(sb, h, repo, c));
    const wrong = cases.flatMap(([h, c, held], i) => {
      const want = held ? GATED[h] : "allow";
      const v = mergeVerdict(got[i]);
      return v === want ? [] : [`${h} ${JSON.stringify(c)}: want ${want}, got ${v}`];
    });
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});

// [line, gated]
const RELEASES: ReadonlyArray<[string, boolean]> = [
  ['eval "$X"', false],
  ['eval "git push --tags"', true],
  ['eval "gh release create v1"', true],
  [HEREDOC_DATE, false],
  ["cat >f <<EOF\n`gh release create v1`\nEOF", true],
  ["cat >f <<EOF\n$(\ngh release create v1\n)\nEOF", true],
  ["for t in a b; do bash scripts/$t.sh; done", false],
  ["for t in tag b; do bash scripts/$t.sh; done", true],
  ['for s in scripts/*.sh; do bash "$s"; done', true],
  ["$CMD --help", false],
  ['G=git; "$G" push origin v1.0.0', true],
  ['gh "$X" create v1', true],
  ["gh $W v1", true],
  ["$(echo tag.sh)", true],
];

Deno.test("guard-release gates what names a release, and only that", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto", head: "feat" });
    await git(sb, repo, "tag", "v1.0.0");
    const got = await pool(RELEASES, async ([command]) =>
      runHook(
        sb,
        "guard-release.sh",
        "codex",
        await payload("codex", "pre_tool_use_bash", { cwd: repo, tool_input: { command } }),
      ));
    const wrong = RELEASES.flatMap(([c, gated], i) => {
      const denied = got[i].code === 2 && got[i].stderr.includes("publishes a release");
      const allowed = got[i].code === 0 && got[i].stdout === "";
      return (gated ? denied : allowed)
        ? []
        : [`${JSON.stringify(c)}: want ${gated ? "gated" : "allowed"}, got ${got[i].code}`];
    });
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});

// [line, refused]
const WRITES: ReadonlyArray<[string, boolean]> = [
  ["ls .specnaut/hooks", false],
  [`echo ${C}`, false],
  [`printf '%s\\n' ${C}`, false],
  [`stat ${C}`, false],
  [`for f in ${C}; do wc "$f"; done`, false],
  [`git grep -n x -- ${C}`, false],
  [`git ls-files ${C}`, false],
  [`git add ${C}; echo done $?`, false],
  [
    `cat >f <<EOF\nprose about .specnaut/hooks and ${C}\n\`date\`\nEOF\ngh issue create --body-file f`,
    false,
  ],
  // still refused: a real write, also through a compound line
  [`echo x >${C}`, true],
  [`printf x >>${C}`, true],
  [`rm ${C}`, true],
  [`ls && rm ${C}`, true],
  [`for f in ${C}; do sed -i x "$f"; done`, true],
  [`for f in docs/*.md; do sed -i x "$f"; done`, true],
  [`git grep -O${"vim"} x ${C}`, true],
  [`cat >f <<EOF\n\`rm ${C}\`\nEOF`, true],
  [`rm ${SELF}`, true],
  [`python3 -c 'open("${C}", "w")'`, true],
];

Deno.test("protect-constitution refuses a write, and not a line that only reads", async () => {
  const sb = await sandbox();
  try {
    const repo = await project(sb);
    const cases = HARNESSES.flatMap((h) => WRITES.map(([c, refused]) => [h, c, refused] as const));
    const got = await pool(cases, async ([h, command]) =>
      runHook(
        sb,
        HOOK,
        h,
        await payload(h, "pre_tool_use_bash", { cwd: repo, tool_input: { command } }),
      ));
    const wrong = cases.flatMap(([h, c, refused], i) => {
      const want = refused ? "deny" : "allow";
      const v = constitutionVerdict(got[i]);
      return v === want ? [] : [`${h} ${JSON.stringify(c)}: want ${want}, got ${v}`];
    });
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});

const editOfHooks = (h: Harness, repo: string) =>
  payload(h, h === "codex" ? "pre_tool_use_apply_patch" : "pre_tool_use_edit", {
    cwd: repo,
    permission_mode: "bypassPermissions",
    tool_input: h === "codex"
      ? { command: `*** Begin Patch\n*** Update File: ${SELF}\n*** End Patch\n` }
      : { file_path: `${repo}/${SELF}` },
  });

Deno.test("the guards phrase releases the hooks in both guards, and never a landing", async () => {
  const sb = await sandbox();
  try {
    const repo = await project(sb);
    const held = await makeRepo(sb, { head: "main" });
    for (const h of HARNESSES) {
      await approve(sb, h, repo, "approve the guard change");
      await approve(sb, h, held, "approve the guard change");
      const edit = await editOfHooks(h, repo);
      assertEquals(
        constitutionVerdict(await runHook(sb, HOOK, h, edit)),
        "allow",
        `${h} constitution`,
      );
      assertEquals((await runHook(sb, "protect-generated.sh", h, edit)).code, 0, `${h} generated`);
      assertEquals(
        mergeVerdict(await mergeBash(sb, h, held, "git push origin main")),
        GATED[h],
        `${h} landing`,
      );
    }
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a refusal over the hooks says what to type", async () => {
  const sb = await sandbox();
  try {
    const repo = await project(sb);
    const r = await runHook(
      sb,
      HOOK,
      "codex",
      await payload("codex", "pre_tool_use_bash", {
        cwd: repo,
        tool_input: { command: `rm ${SELF}` },
      }),
    );
    assertEquals(r.code, 2);
    assertEquals(r.stderr.includes("approve the guard change"), true, r.stderr);
    assertEquals(r.stderr.includes("constitution` verb"), false, r.stderr);
  } finally {
    await sb.cleanup();
  }
});
