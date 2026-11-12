// `--objects <dir>` makes git read the objects of that folder, and nothing else of it that could
// stand in for them: a folder that names further alternates (over http, or any but the one line
// GitBranchFetcher writes), or a path git would split or unquote, is refused by _explicit_head.sh;
// and every git call given the folder turns its commit graphs and multi-pack indexes off. The
// refusals are driven through git-read.sh, since every script takes the folder through the same
// check; the git settings are asserted on each script that takes the folder.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { GitBranchFetcher } from "../../src/infrastructure/git_branch_fetch.ts";
import {
  BOUNDARIES_CONFIG_PATH,
  SIZE_LIMITS_CONFIG_PATH,
} from "../../src/domain/constitution_paths.ts";
import { blob, commit, git as rawGit, initRepo, tree } from "../helpers/git_fixture.ts";
import { gitRead } from "../templates/git_read_fixture.ts";
import { scope } from "../templates/collect_audit_scope_fixture.ts";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import {
  assertNoGraphs,
  bashScript,
  git,
  gitRecorder,
  gitRecorderUnsure,
  type HeadRepo,
  headRepo,
} from "./explicit_head_fixture.ts";
import { FILE, lines, SCRIPT as SIZE_RATCHET } from "./size_ratchet_fixture.ts";

const BOUNDARY_CHECK = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/boundary-check.sh", import.meta.url),
);

const fixture = () => headRepo({ "src/a.ts": "a\n" }, { "src/head_only.ts": "h\n" });

/** `git-read --head <head> --objects <objects> files`, the refusal it printed, or "". */
async function filesWith(repo: HeadRepo, objects: string): Promise<string> {
  const r = await gitRead(["--head", repo.head, "--objects", objects, "files"], repo.root);
  if (r.code === 0) return "";
  assertEquals(r.code, 2, r.stderr);
  return r.stderr;
}

/** Another repository's objects folder: one the project never vouched for. */
async function strangerObjects(): Promise<string> {
  const other = await Deno.makeTempDir({ prefix: "explicit-head-other-" });
  await git(other, "init", "-q");
  return bashPath(join(other, ".git", "objects"));
}

Deno.test("explicit head: the export GitBranchFetcher writes is read as it is", async () => {
  const base = await Deno.makeTempDir({ prefix: "explicit-head-fetch-" });
  const [remote, project] = [join(base, "remote"), join(base, "project")];
  for (const d of [remote, project]) {
    await Deno.mkdir(d);
    await initRepo(d);
  }
  const sha = await commit(
    remote,
    await tree(remote, [["100644", "a.ts", await blob(remote, "a")]]),
  );
  await rawGit(remote, ["update-ref", "refs/heads/topic", sha]);
  await rawGit(project, ["remote", "add", "origin", remote]);
  const out = join(base, "out.git");
  const fetcher = new GitBranchFetcher(project, { protocols: ["file"] });
  assertEquals(await fetcher.fetch({ kind: "ref", remote: "origin", branch: "topic" }, out), sha);
  const objects = bashPath(join(out, "objects"));
  const r = await gitRead(["--head", sha, "--objects", objects, "files"], project);
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.stdout.trim(), "a.ts");
});

Deno.test("explicit head: an objects folder naming http alternates is refused", async () => {
  const repo = await fixture();
  await Deno.writeTextFile(
    join(repo.objects, "info", "http-alternates"),
    "https://example.invalid/o\n",
  );
  assertStringIncludes(
    await filesWith(repo, repo.objects),
    `git-read: refused: --head: an objects folder naming http alternates: ${repo.objects}`,
  );
});

Deno.test("explicit head: alternates other than this repository's own objects are refused", async () => {
  const repo = await fixture();
  const alternates = join(repo.objects, "info", "alternates");
  const own = (await Deno.readTextFile(alternates)).trimEnd();
  const stranger = await strangerObjects();
  const shapes: [string, string][] = [
    ["a second line", `${own}\n${stranger}\n`],
    ["another repository", `${stranger}\n`],
    ["a path relative to the work tree", ".git/objects\n"],
    ["a quoted path", `"${own}"\n`],
  ];
  for (const [what, text] of shapes) {
    await Deno.writeTextFile(alternates, text);
    assertStringIncludes(
      await filesWith(repo, repo.objects),
      `--head: an objects folder borrowing from more than this repository: ${repo.objects}`,
      what,
    );
  }
  await Deno.writeTextFile(alternates, `${own}\n`);
  assertEquals(await filesWith(repo, repo.objects), "", "the fixture's own line");
});

Deno.test({
  name: "explicit head: alternates that are a link are refused, whatever they point at",
  ignore: Deno.build.os === "windows", // Deno.symlink needs a privilege the runner may lack
  fn: async () => {
    const repo = await fixture();
    const alternates = join(repo.objects, "info", "alternates");
    const elsewhere = join(await Deno.makeTempDir({ prefix: "explicit-head-link-" }), "alternates");
    await Deno.rename(alternates, elsewhere);
    await Deno.symlink(elsewhere, alternates);
    assertStringIncludes(
      await filesWith(repo, repo.objects),
      "--head: an objects folder borrowing from more than this repository",
    );
  },
});

Deno.test("explicit head: an objects path git would split as a list or unquote is refused", async () => {
  const repo = await fixture();
  const stranger = await strangerObjects();
  const cases: [string, string][] = [
    [`${repo.objects}:${stranger}`, "a path git would split as a list"],
    [`${repo.objects};${stranger}`, "a path git would split as a list"],
    [`"${repo.objects}"`, "a path git would unquote"],
  ];
  for (const [objects, why] of cases) {
    assertStringIncludes(await filesWith(repo, objects), `--head: ${why}: ${objects}`, objects);
  }
});

/** A head the size ratchet, the boundary check and the audit scope all have work on. */
const allScripts = () =>
  headRepo(
    {
      [SIZE_LIMITS_CONFIG_PATH]: FILE(20, 25),
      [BOUNDARIES_CONFIG_PATH]: "domain:\n  - 'src'\nforbid:\n  - '^import .* from \"web\"'\n",
      "src/a.ts": "a\n",
    },
    { "src/a.ts": lines(10), "src/head_only.ts": "h\n" },
  );

const sweep = { ignore: gitRecorderUnsure };

Deno.test({
  ...sweep,
  name: "explicit head: size-ratchet reads the objects folder with its graphs off",
  fn: async () => {
    const repo = await allScripts();
    const rec = await gitRecorder();
    const args = ["--since", repo.base, "--head", repo.head, "--objects", repo.objects, "--report"];
    const r = await bashScript(SIZE_RATCHET, args, repo.root, rec.env);
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertStringIncludes(r.stdout, "src/a.ts: 1 → 10");
    assertNoGraphs(await rec.calls(), "size-ratchet");
  },
});

Deno.test({
  ...sweep,
  name: "explicit head: boundary-check reads the objects folder with its graphs off",
  fn: async () => {
    const repo = await allScripts();
    const rec = await gitRecorder();
    const r = await bashScript(
      BOUNDARY_CHECK,
      ["--head", repo.head, "--objects", repo.objects],
      repo.root,
      rec.env,
    );
    assertEquals(r.code, 0, r.stdout + r.stderr);
    assertStringIncludes(r.stdout, "2 file(s) under domain: clean");
    assertNoGraphs(await rec.calls(), "boundary-check");
  },
});

Deno.test({
  ...sweep,
  name: "explicit head: git-read reads the objects folder with its graphs off, in every form",
  fn: async () => {
    const repo = await allScripts();
    const rec = await gitRecorder();
    const head = ["--head", repo.head, "--objects", repo.objects];
    for (
      const form of [
        ["files", "src"],
        ["names", repo.base, repo.head],
        ["log", `${repo.base}..${repo.head}`],
        ["show", repo.head, "--stat"],
        ["base", "main"],
        ["grep", "a", repo.head],
      ]
    ) {
      const r = await gitRead([...head, ...form], repo.root, rec.env);
      assertEquals(r.code, 0, form.join(" ") + r.stderr);
    }
    assertNoGraphs(await rec.calls(), "git-read");
  },
});

Deno.test({
  ...sweep,
  name: "explicit head: collect-audit-scope reads the objects folder with its graphs off",
  fn: async () => {
    const repo = await allScripts();
    const rec = await gitRecorder();
    const r = await scope(
      repo.root,
      ["--last", "1", "--head", repo.head, "--objects", repo.objects],
      rec.env,
    );
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "src/head_only.ts\n");
    assertNoGraphs(await rec.calls(), "collect-audit-scope");
  },
});
