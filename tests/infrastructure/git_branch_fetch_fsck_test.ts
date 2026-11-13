import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ExportRefused } from "../../src/application/untrusted_review_ports.ts";
import {
  fetchArgs,
  GitBranchFetcher,
  PINNED_FSCK_CHECKS,
} from "../../src/infrastructure/git_branch_fetch.ts";
import {
  blob,
  commit,
  git,
  initRepo,
  type RawEntry,
  tempDir,
  tree,
} from "../helpers/git_fixture.ts";

/**
 * What a fetch refuses whatever the user's configuration says: each tree fsck would let through at
 * a warning is refused, and no bundle a server advertises is fetched.
 */

const configs = (args: string[]) => args.flatMap((a, i) => (args[i - 1] === "-c" ? [a] : []));

Deno.test("each fsck check git leaves at a warning is pinned to an error", () => {
  const set = configs(fetchArgs("u", "r", ["https"]));
  for (const id of PINNED_FSCK_CHECKS) {
    assertEquals(set.includes(`fetch.fsck.${id}=error`), true, id);
  }
  assertEquals(
    [...PINNED_FSCK_CHECKS].sort(),
    [
      "badFilemode",
      "emptyName",
      "fullPathname",
      "hasDot",
      "hasDotdot",
      "hasDotgit",
      "zeroPaddedFilemode",
    ],
  );
});

Deno.test("no bundle a server advertises is fetched, nor one the configuration names", () => {
  const set = configs(fetchArgs("u", "r", ["https"]));
  assertEquals(set.filter((c) => c.startsWith("transfer.bundleURI")), ["transfer.bundleURI=false"]);
  assertEquals(set.filter((c) => c.startsWith("fetch.bundleURI")), ["fetch.bundleURI="]);
});

Deno.test("each refused transport is pinned to never, before the allowlist re-allows one", () => {
  const set = configs(fetchArgs("u", "r", ["https", "ssh"]));
  for (const p of ["file", "ext", "git", "http"]) {
    assertEquals(
      set.filter((c) => c.startsWith(`protocol.${p}.`)),
      [`protocol.${p}.allow=never`],
      p,
    );
  }
  const allowed = configs(fetchArgs("u", "r", ["file"]));
  const at = (c: string) => allowed.indexOf(c);
  assert(at("protocol.file.allow=never") < at("protocol.file.allow=always"), "the allowlist wins");
});

/**
 * One tree per pinned check, each carrying the entry that check reports. `emptyName` has none: git's
 * own server cannot send such a tree (its pack walk dies on the name), so the argument list above is
 * its test.
 */
const OFFENDERS: Record<string, (id: string) => RawEntry> = {
  hasDot: (id) => ["100644", ".", id],
  hasDotdot: (id) => ["100644", "..", id],
  hasDotgit: (id) => ["100644", ".git", id],
  fullPathname: (id) => ["100644", "a/b", id],
  badFilemode: (id) => ["100600", "a", id],
  zeroPaddedFilemode: (id) => ["0100644", "a", id],
};

/** A HOME whose git configuration lowers every pinned check to `ignore`. */
async function relaxedHome(base: string): Promise<string> {
  const home = join(base, "home");
  await Deno.mkdir(home);
  const lines = PINNED_FSCK_CHECKS.map((id) => `\t${id} = ignore`).join("\n");
  await Deno.writeTextFile(join(home, ".gitconfig"), `[fetch "fsck"]\n${lines}\n`);
  return home;
}

Deno.test("a tree fsck reports at a warning is refused, though the user's configuration ignores it", async () => {
  const base = await tempDir("fetch-fsck-");
  try {
    const [remote, project] = ["remote", "project"].map((d) => join(base, d));
    for (const d of [remote, project]) await initRepo(await Deno.mkdir(d).then(() => d));
    await git(project, ["remote", "add", "origin", remote]);
    const id = await blob(remote, "x");
    const home = await relaxedHome(base);
    const env = (name: string) => name === "HOME" ? home : Deno.env.get(name);
    const fetcher = new GitBranchFetcher(project, { protocols: ["file"], env });
    const sent = PINNED_FSCK_CHECKS.filter((id) => id !== "emptyName");
    assertEquals(Object.keys(OFFENDERS).sort(), sent.sort());
    for (const [check, entry] of Object.entries(OFFENDERS)) {
      const bad = await tree(remote, [entry(id)]);
      await git(remote, ["update-ref", `refs/heads/${check}`, await commit(remote, bad)]);
      const source = { kind: "ref", remote: "origin", branch: check } as const;
      const out = join(base, `${check}.git`);
      const err = await assertRejects(() => fetcher.fetch(source, out), ExportRefused);
      assertStringIncludes(err.message, `${check}:`, `refused, but not by ${check}`);
    }
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
