import { assertEquals } from "@std/assert";
import { basename, DELIMITER, join } from "@std/path";
import {
  entryUnsafe,
  filterGitPath,
  gitMissing,
  spellingUnsafe,
  treeTop,
} from "../../src/infrastructure/git_path.ts";

/**
 * The PATH the binary starts git with. Links across the tree's edge are in the table every
 * spelling of the rule shares (`tests/scripts/resolve_verifier_test.ts`), which Windows runners
 * skip; these cases need no link, so Windows runs them too, and the platform's own spellings are
 * judged here with the platform passed in.
 */

const RELATIVE = "is not an absolute path";
const DOTTED = "has a . or .. component";

Deno.test("an empty, relative, `~` or dotted entry is unsafe on POSIX", () => {
  const cases: [string, string | undefined][] = [
    ["", "is empty"],
    ["bin", RELATIVE],
    [".", RELATIVE],
    ["~/bin", RELATIVE],
    ["C:\\Git\\cmd", RELATIVE],
    ["/usr/./bin", DOTTED],
    ["/usr/../bin", DOTTED],
    ["/usr/bin/..", DOTTED],
    ["/usr/bin", undefined],
    ["/usr/bin...", undefined],
  ];
  for (const [entry, why] of cases) assertEquals(spellingUnsafe(entry, "linux"), why, entry);
});

Deno.test("on Windows an entry is absolute only with its drive's root or a share", () => {
  const cases: [string, string | undefined][] = [
    ["C:\\Git\\cmd", undefined],
    ["c:/Git/cmd", undefined],
    ["\\\\host\\share\\bin", undefined],
    ["", "is empty"],
    ["C:Git", RELATIVE],
    ["\\Git\\cmd", RELATIVE],
    ["/usr/bin", RELATIVE],
    ["~\\bin", RELATIVE],
    ['"C:\\Git\\cmd"', RELATIVE],
    ["C:\\Git\\..\\cmd", DOTTED],
    ["C:/Git/./cmd", DOTTED],
    ["C:\\Git/..", DOTTED],
  ];
  for (const [entry, why] of cases) assertEquals(spellingUnsafe(entry, "windows"), why, entry);
});

Deno.test("the entries are split on the platform passed in, whichever runs the test", () => {
  const empty = { kept: "", dropped: { entry: "", why: "is empty" } };
  assertEquals(filterGitPath(";rel;C:\\x\\..", Deno.cwd(), "windows"), empty);
  assertEquals(filterGitPath(":rel:/x/..", Deno.cwd(), "darwin"), empty);
});

/** A repository with a `bin` folder and a file at its top, a folder outside it, then removed. */
async function inTree(fn: (tmp: string, repo: string) => void): Promise<void> {
  const tmp = await Deno.realPath(await Deno.makeTempDir({ prefix: "git-path-" }));
  const repo = join(tmp, "repo");
  try {
    for (const d of [join(repo, ".git"), join(repo, "bin"), join(repo, "sub"), join(tmp, "out")]) {
      await Deno.mkdir(d, { recursive: true });
    }
    await Deno.writeTextFile(join(tmp, "file"), "");
    fn(tmp, repo);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

Deno.test("the tree's top is the nearest folder above holding a .git, else the folder itself", () =>
  inTree((tmp, repo) => {
    assertEquals(treeTop(join(repo, "sub")), repo);
    assertEquals(treeTop(repo), repo);
    assertEquals(treeTop(join(tmp, "out")), join(tmp, "out"));
  }));

Deno.test("a bare repository nested in a work tree has that tree's top, not its own folder", () =>
  inTree((_, repo) => {
    const bare = join(repo, "sub", "nested.git");
    Deno.mkdirSync(join(bare, "refs"), { recursive: true });
    Deno.writeTextFileSync(join(bare, "HEAD"), "ref: refs/heads/main\n");
    assertEquals(treeTop(bare), repo);
  }));

Deno.test({
  name: "the tree's top is found from the folder the working folder resolves to",
  // A link needs a privilege Windows runners lack.
  ignore: Deno.build.os === "windows",
  fn: () =>
    inTree((tmp, repo) => {
      Deno.symlinkSync(join(repo, "sub"), join(tmp, "sublink"));
      assertEquals(treeTop(join(tmp, "sublink")), repo);
    }),
});

Deno.test("an entry in the tree, made or not, is unsafe; one beside it or outside is kept", () =>
  inTree((tmp, repo) => {
    const cases: [string, string | undefined][] = [
      [join(repo, "bin"), "is inside the repository"],
      [join(repo, "not", "made"), "is inside the repository"],
      [repo, "is inside the repository"],
      [join(tmp, "file"), "names a folder that cannot be entered"],
      [join(tmp, "out"), undefined],
      [join(tmp, "out", "not", "made"), undefined],
      [tmp, undefined],
    ];
    for (const [entry, why] of cases) assertEquals(entryUnsafe(entry, repo), why, entry);
  }));

Deno.test("the PATH git gets, from a folder of the tree, keeps only what is outside it", () =>
  inTree((tmp, repo) => {
    const path = [join(repo, "bin"), "", join(tmp, "out"), "bin", tmp].join(DELIMITER);
    const kept = [join(tmp, "out"), tmp].join(DELIMITER);
    assertEquals(filterGitPath(path, join(repo, "sub")).kept, kept);
  }));

Deno.test("the PATH git gets names the first entry it left out, and why", () =>
  inTree((tmp, repo) => {
    const path = [join(tmp, "out"), join(repo, "bin"), "", tmp].join(DELIMITER);
    assertEquals(filterGitPath(path, repo), {
      kept: [join(tmp, "out"), tmp].join(DELIMITER),
      dropped: { entry: join(repo, "bin"), why: "is inside the repository" },
    });
    assertEquals(filterGitPath(tmp, repo), { kept: tmp, dropped: undefined });
  }));

Deno.test("a git not found names the entry left out, which may be where it is", () => {
  assertEquals(gitMissing("git is not on the PATH", undefined), "git is not on the PATH");
  assertEquals(
    gitMissing("git is not on the PATH", { entry: "/r/bin", why: "is inside the repository" }),
    'git is not on the PATH; the entry "/r/bin" was left out because it is inside the repository',
  );
});

/** Whether the file system the tests' folders are made on ignores case, probed on one made for it. */
function caseBlind(): boolean {
  const dir = Deno.makeTempDirSync({ prefix: "git-path-case-" });
  const upper = join(dir, "..", basename(dir).toUpperCase());
  try {
    return Deno.statSync(upper).isDirectory;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  } finally {
    Deno.removeSync(dir);
  }
}

Deno.test({
  name: "an entry naming the repository in another case is in it where case is ignored",
  // Where the file system tells case apart, the other case names another folder: nothing to check.
  ignore: !caseBlind(),
  fn: () =>
    inTree((_, repo) => {
      const upper = repo.slice(0, -"repo".length) + "REPO";
      assertEquals(entryUnsafe(join(upper, "bin"), repo), "is inside the repository");
    }),
});
