import { assertEquals, assertRejects } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { programOnPath } from "../../src/infrastructure/program_on_path.ts";
import {
  GitRefused,
  UntrustedGit,
  untrustedGitEnv,
} from "../../src/infrastructure/untrusted_git.ts";
import {
  LAZY_FETCH_FLAG,
  PLAIN_DIFF_FLAGS,
  UNTRUSTED_GIT_ENV,
  UNTRUSTED_GIT_FLAGS,
} from "../../src/infrastructure/untrusted_git_flags.ts";
import { callerPath, plantGit, ran, withPath } from "../helpers/planted_git.ts";

/**
 * The binary's hardened git and the shell scripts' hardened git are two copies of one list:
 * `_git_untrusted.sh` is where it was written first, and these tests hold the TypeScript copy to it.
 */

const SCRIPT = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/_git_untrusted.sh", import.meta.url),
);
const source = await Deno.readTextFile(SCRIPT);

/** The words of `_gu_git`'s command line, from `_gu_env_run` to `"$@"`, line continuations joined. */
function scriptFlags(): string[] {
  const start = source.indexOf("_gu_env_run --no-pager");
  const end = source.indexOf('"$@"', start);
  const words = source.slice(start, end).replaceAll("\\\n", " ").split(/\s+/).filter(Boolean);
  // The command itself, and the lazy-fetch array, which the TypeScript adds by version too.
  return words.filter((w) => w !== "_gu_env_run" && !w.startsWith("${lazy"));
}

/** The words of the first non-empty `<name>=(...)` assignment: `local lazy=()` declares it empty. */
function scriptArray(name: string): string[] {
  const m = new RegExp(`\\b${name}=\\(([^)]+)\\)`).exec(source);
  if (m === null) throw new Error(`${name}=(...) is not in _git_untrusted.sh`);
  return m[1].split(/\s+/).filter(Boolean);
}

Deno.test("the TypeScript flag list is the one _git_untrusted.sh passes, in its order", () => {
  const flags = scriptFlags();
  assertEquals(flags.length > 10, true, `parsed too little from the script: ${flags.join(" ")}`);
  assertEquals([...UNTRUSTED_GIT_FLAGS], flags);
});

Deno.test("the lazy-fetch and plain-diff flags are the script's", () => {
  assertEquals([LAZY_FETCH_FLAG], scriptArray("lazy"));
  assertEquals([...PLAIN_DIFF_FLAGS], scriptArray("_GU_PLAIN"));
});

Deno.test("the variables the script exports are set, and no system configuration is read", () => {
  const exported = [...source.matchAll(/^ {2}(?:\w+ && )?export (GIT_[^\n]*)/gm)].flatMap((m) =>
    m[1].split(/\s+/)
  );
  const fromScript = Object.fromEntries(exported.map((kv) => kv.split("=")));
  assertEquals(UNTRUSTED_GIT_ENV, { ...fromScript, GIT_CONFIG_NOSYSTEM: "1" });
});

Deno.test("only the allowlist of the caller's environment reaches git, and no GIT_* variable", () => {
  // The folder of the caller's own git: a PATH holding no git is refused before any env is made.
  const bin = dirname(programOnPath("git", Deno.env.get("PATH") ?? "")!);
  const caller: Record<string, string> = {
    PATH: bin,
    HOME: "/home/u",
    GIT_DIR: "/elsewhere",
    GIT_CONFIG_GLOBAL: "/elsewhere/config",
    GIT_CONFIG_PARAMETERS: "'core.fsmonitor'='x'",
    EDITOR: "vi",
  };
  assertEquals(untrustedGitEnv((name) => caller[name], Deno.cwd()).env, {
    PATH: bin,
    HOME: "/home/u",
    ...UNTRUSTED_GIT_ENV,
  });
});

Deno.test("a GIT_DIR in the caller's environment does not redirect the hardened git", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "untrusted-git-" }));
  try {
    await new Deno.Command("git", { args: ["init", "-q"], cwd: dir }).output();
    Deno.env.set("GIT_DIR", `${dir}/no-such-git-dir`);
    try {
      const plain = await new Deno.Command("git", { args: ["rev-parse", "--git-dir"], cwd: dir })
        .output();
      assertEquals(plain.success, false, "plain git must follow GIT_DIR, or this proves nothing");
      const out = await new UntrustedGit(dir).run("rev-parse", ["--git-dir"]);
      assertEquals(new TextDecoder().decode(out).trim(), ".git");
    } finally {
      Deno.env.delete("GIT_DIR");
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** A repository holding a `git` of its own, at its top and in `bin`; where it marks a run. */
async function plantedRepo(dir: string): Promise<string> {
  await new Deno.Command("git", { args: ["init", "-q"], cwd: dir }).output();
  for (const at of [dir, join(dir, "bin")]) await plantGit(at, join(dir, "fired"));
  return join(dir, "fired");
}

/** `fn` given a fresh physical temp folder, removed after. */
async function inTemp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "untrusted-git-" }));
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/**
 * Where the planted git runs: on Windows it cannot leave a mark (`plantGit`), so what proves the
 * real git ran is what it printed, which the planted one never prints.
 */
const decoded = (out: Uint8Array) => new TextDecoder().decode(out).trim();

Deno.test("the git the binary starts is looked up only on PATH entries outside the tree", () =>
  inTemp(async (dir) => {
    const fired = await plantedRepo(dir);
    const path = ["", ".", "bin", join(dir, "bin"), ...callerPath()];
    const out = await withPath(path, () => new UntrustedGit(dir).run("rev-parse", ["--git-dir"]));
    assertEquals(decoded(out), ".git");
    assertEquals(await ran(fired), false, "planted git ran");
  }));

Deno.test("a PATH with no entry outside the repository is refused, never searched", () =>
  inTemp(async (dir) => {
    const fired = await plantedRepo(dir);
    await withPath(["", join(dir, "bin")], () =>
      assertRejects(
        () => new UntrustedGit(dir).run("rev-parse", ["--git-dir"]),
        GitRefused,
        'no PATH entry outside the repository; the entry "" was left out because it is empty',
      ));
    assertEquals(await ran(fired), false, "planted git ran");
  }));

Deno.test("a git found on no entry left names the first entry left out, and why", () =>
  inTemp(async (dir) => {
    const fired = await plantedRepo(dir);
    const outside = await Deno.makeTempDir({ prefix: "untrusted-git-empty-" });
    try {
      await withPath([join(dir, "bin"), outside], () =>
        assertRejects(
          () => new UntrustedGit(dir).run("rev-parse", ["--git-dir"]),
          GitRefused,
          `git is not on the PATH; the entry "${
            join(dir, "bin")
          }" was left out because it is inside the repository`,
        ));
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
    assertEquals(await ran(fired), false, "planted git ran");
  }));

Deno.test("an instance starts every git with the PATH it filtered at its first call", () =>
  inTemp(async (dir) => {
    await new Deno.Command("git", { args: ["init", "-q"], cwd: dir }).output();
    const git = new UntrustedGit(dir);
    assertEquals(decoded(await git.run("rev-parse", ["--git-dir"])), ".git");
    const outside = await Deno.makeTempDir({ prefix: "untrusted-git-empty-" });
    try {
      const again = await withPath([outside], () => git.run("rev-parse", ["--git-dir"]));
      assertEquals(decoded(again), ".git");
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  }));
