import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { git, HARNESSES, makeRepo, pool, sandbox } from "./hook_sandbox.ts";
import { bash, GATED, verdict } from "./guard_merge_fixture.ts";

/**
 * cli#711 — a git alias in either syntax git reads. `[alias] pz = …` is
 * `alias.pz`; git 2.54 adds `[alias "pz"] command = …`, which `git config
 * --get alias.pz` does not see (exit 1), so `git pz` read as "no alias" and a
 * push to the base ran under `merge: manual` with no question. When both are
 * set, git runs the one defined last — which `config --get` cannot tell — so
 * the alias is gated. So is one git cannot answer for: a config it fails to
 * read exits 128, not 1, and is no proof that there is no alias.
 */

/** [repo, command, gated under manual?] */
const FORMS: ReadonlyArray<[repo: "feat" | "main", command: string, gated: boolean]> = [
  ["feat", "git pz", true],
  ["feat", "git pz2", true], // through a second alias
  ["main", "git mz", true],
  ["feat", "git both", true], // `[alias] both = status`, then the push: git runs the push
  ["feat", "git st2", false],
  ["feat", "git st2 --short", false],
  ["main", "git st2", false],
];

/** Each alias in the subsection syntax, but `both`, which is in the two. */
async function aliases(repo: string, sb: Awaited<ReturnType<typeof sandbox>>) {
  await git(sb, repo, "config", "alias.pz.command", "push origin main");
  await git(sb, repo, "config", "alias.pz2.command", "pz");
  await git(sb, repo, "config", "alias.mz.command", "merge feat");
  await git(sb, repo, "config", "alias.st2.command", "status");
  await git(sb, repo, "config", "alias.both", "status");
  await git(sb, repo, "config", "alias.both.command", "push origin main");
}

Deno.test('guard-merge: a git alias in git 2.54\'s [alias "<name>"] syntax is read', async () => {
  const sb = await sandbox();
  try {
    const repos = {
      manual: {
        feat: await makeRepo(sb, { head: "feat" }),
        main: await makeRepo(sb, { head: "main" }),
      },
      auto: {
        feat: await makeRepo(sb, { head: "feat", mode: "auto" }),
        main: await makeRepo(sb, { head: "main", mode: "auto" }),
      },
    };
    for (const mode of Object.values(repos)) {
      for (const r of Object.values(mode)) await aliases(r, sb);
    }
    const cases = HARNESSES.flatMap((h) =>
      FORMS.flatMap(([on, c, gated]) =>
        [
          [h, "manual", repos.manual[on], c, gated],
          [h, "auto", repos.auto[on], c, false],
        ] as const
      )
    );
    const got = await pool(cases, ([h, , repo, command]) => bash(sb, h, repo, command));
    const wrong = cases.flatMap(([h, mode, , command, gated], i) => {
      const want = gated ? GATED[h] : "allow";
      const v = verdict(got[i]);
      return v === want
        ? []
        : [`${h} [${mode}] ${JSON.stringify(command)}: want ${want}, got ${v}`];
    });
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});

Deno.test("guard-merge: a git config it cannot read is no proof that there is no alias", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { head: "feat" });
    // An include git fails to parse: `config --get` exits 128 for every key.
    await git(sb, repo, "config", "include.path", "broken.cfg");
    await Deno.writeTextFile(join(repo, ".git", "broken.cfg"), "[alias\n");
    for (const h of HARNESSES) {
      assertEquals(verdict(await bash(sb, h, repo, "git worktree list")), GATED[h], h);
      // a subcommand on cmd_git's own list is never looked up
      assertEquals(verdict(await bash(sb, h, repo, "git status")), "allow", h);
    }
  } finally {
    await sb.cleanup();
  }
});
