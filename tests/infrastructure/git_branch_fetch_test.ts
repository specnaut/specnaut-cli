import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ExportRefused } from "../../src/application/untrusted_review_ports.ts";
import { FETCHED_REF } from "../../src/domain/branch_source.ts";
import {
  DEFAULT_PROTOCOLS,
  fetchArgs,
  GitBranchFetcher,
  redacted,
} from "../../src/infrastructure/git_branch_fetch.ts";
import { blob, commit, git, initRepo, tempDir, tree } from "../helpers/git_fixture.ts";

Deno.test("the URL and the refspec come after --, and nothing follows them", () => {
  const args = fetchArgs("-oops", "refs/heads/x", ["https"]);
  assertEquals(args.slice(-3), ["--", "-oops", `refs/heads/x:${FETCHED_REF}`]);
  assertEquals(args.indexOf("--"), args.length - 3);
});

Deno.test("the fetch pins its transports, takes no tag or submodule, and runs fsck", () => {
  const args = fetchArgs("u", "r", ["https", "ssh"]);
  const configs = args.flatMap((a, i) => (args[i - 1] === "-c" ? [a] : []));
  for (
    const c of [
      "protocol.allow=never",
      "protocol.https.allow=always",
      "protocol.ssh.allow=always",
      "transfer.fsckObjects=true",
      "fetch.fsckObjects=true",
      "core.hooksPath=/dev/null",
      "fetch.recurseSubmodules=false",
    ]
  ) assertEquals(configs.includes(c), true, c);
  assertEquals(configs.some((c) => c.startsWith("protocol.file")), false);
  for (const flag of ["--no-tags", "--no-recurse-submodules"]) {
    assertEquals(args.includes(flag), true, flag);
  }
  assertEquals([...DEFAULT_PROTOCOLS], ["https", "ssh"]);
});

type World = { remote: string; project: string; out: string; cleanup: () => Promise<void> };

/** A remote with a branch, a PR head and a tag; a project whose `origin` points at it. */
async function world(): Promise<World & { head: string; pr: string }> {
  const base = await tempDir("fetch-");
  const [remote, project] = ["remote", "project"].map((d) => join(base, d));
  for (const d of [remote, project]) await Deno.mkdir(d);
  await initRepo(remote);
  const head = await commit(remote, await tree(remote, [["100644", "a", await blob(remote, "a")]]));
  await git(remote, ["update-ref", "refs/heads/topic", head]);
  const pr = await commit(remote, await tree(remote, [["100644", "b", await blob(remote, "b")]]));
  await git(remote, ["update-ref", "refs/pull/7/head", pr]);
  await git(remote, ["tag", "v1", pr]);
  await initRepo(project);
  await git(project, ["remote", "add", "origin", remote]);
  await git(project, ["remote", "add", "my/fork", remote]);
  const out = join(base, "out.git");
  return { remote, project, out, head, pr, cleanup: () => Deno.remove(base, { recursive: true }) };
}

const local = (project: string, timeoutMs?: number) =>
  new GitBranchFetcher(project, { protocols: ["file"], timeoutMs });

Deno.test("the configured remotes are listed by name", async () => {
  const w = await world();
  try {
    assertEquals((await local(w.project).remotes()).sort(), ["my/fork", "origin"]);
  } finally {
    await w.cleanup();
  }
});

Deno.test("a PR head is fetched into a bare repository that borrows the project's objects", async () => {
  const w = await world();
  try {
    const sha = await local(w.project).fetch({ kind: "pr", remote: "origin", number: 7 }, w.out);
    assertEquals(sha, w.pr);
    const alternates = await Deno.readTextFile(join(w.out, "objects", "info", "alternates"));
    assertEquals(alternates, `${join(await Deno.realPath(w.project), ".git", "objects")}\n`);
    assertEquals(await git(w.out, ["rev-parse", "--is-bare-repository"]), "true");
    assertEquals(await git(w.out, ["for-each-ref", "--format=%(refname)"]), FETCHED_REF);
    assertEquals(await Deno.lstat(join(w.out, "hooks")).then(() => true, () => false), false);
  } finally {
    await w.cleanup();
  }
});

Deno.test("a branch on a named remote is fetched by its head id", async () => {
  const w = await world();
  try {
    const source = { kind: "ref", remote: "my/fork", branch: "topic" } as const;
    assertEquals(await local(w.project).fetch(source, w.out), w.head);
  } finally {
    await w.cleanup();
  }
});

Deno.test("by default a file remote is refused: only https and ssh are allowed", async () => {
  const w = await world();
  try {
    const fetcher = new GitBranchFetcher(w.project);
    const source = { kind: "ref", remote: "origin", branch: "topic" } as const;
    await assertRejects(
      () => fetcher.fetch(source, w.out),
      ExportRefused,
      "transport 'file' not allowed",
    );
  } finally {
    await w.cleanup();
  }
});

Deno.test("objects fsck refuses are not received", async () => {
  const w = await world();
  try {
    const bad = await tree(w.remote, [["100644", "..", await blob(w.remote, "x")]]);
    await git(w.remote, ["update-ref", "refs/heads/bad", await commit(w.remote, bad)]);
    const source = { kind: "ref", remote: "origin", branch: "bad" } as const;
    await assertRejects(() => local(w.project).fetch(source, w.out), ExportRefused, "fsck");
  } finally {
    await w.cleanup();
  }
});

Deno.test({
  name: "a fetch that outlives its timeout is killed, not waited for",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const w = await world();
    const home = Deno.env.get("HOME");
    try {
      // The user's own config names an ssh command that hangs; `; :` swallows the host and the
      // command git appends, quoted since `;` opens a comment in git's config. The fetch must be
      // stopped, not waited for.
      const fakeHome = join(w.out, "..", "home");
      await Deno.mkdir(fakeHome);
      await Deno.writeTextFile(
        join(fakeHome, ".gitconfig"),
        '[core]\n\tsshCommand = "sleep 20; :"\n',
      );
      await git(w.project, ["remote", "set-url", "origin", "ssh://example.invalid/x.git"]);
      Deno.env.set("HOME", fakeHome);
      const fetcher = new GitBranchFetcher(w.project, { timeoutMs: 500 });
      const source = { kind: "ref", remote: "origin", branch: "topic" } as const;
      const started = Date.now();
      await assertRejects(() => fetcher.fetch(source, w.out), ExportRefused, "did not finish");
      assertEquals(Date.now() - started < 10_000, true, "the fetch was waited for, not killed");
    } finally {
      if (home === undefined) Deno.env.delete("HOME");
      else Deno.env.set("HOME", home);
      await w.cleanup();
    }
  },
});

Deno.test("credentials in a URL git echoes are redacted", () => {
  assertEquals(
    redacted("fatal: unable to access 'https://bob:s3cret@example.com/x.git/'"),
    "fatal: unable to access 'https://***@example.com/x.git/'",
  );
  assertEquals(redacted("ssh://example.com/x"), "ssh://example.com/x");
});
