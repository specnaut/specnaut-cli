import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
  LAZY_FETCH_FLAG,
  PLAIN_DIFF_FLAGS,
  UNTRUSTED_GIT_ENV,
  UNTRUSTED_GIT_FLAGS,
  UntrustedGit,
  untrustedGitEnv,
} from "../../src/infrastructure/untrusted_git.ts";

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
  const caller: Record<string, string> = {
    PATH: "/bin",
    HOME: "/home/u",
    GIT_DIR: "/elsewhere",
    GIT_CONFIG_GLOBAL: "/elsewhere/config",
    GIT_CONFIG_PARAMETERS: "'core.fsmonitor'='x'",
    EDITOR: "vi",
  };
  assertEquals(untrustedGitEnv((name) => caller[name]), {
    PATH: "/bin",
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
