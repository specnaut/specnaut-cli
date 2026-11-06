import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { plainBranchName } from "../../src/domain/base_branch.ts";

/**
 * `base-branch.sh` and the binary agree on which names are a branch they hand to git: each name is
 * set as `init.defaultBranch` in a repository with no origin, and the script's answer, printed or
 * refused, is compared with `plainBranchName`'s. The name only: where the binary reads it from is
 * its own rule (origin/HEAD, else the global configuration).
 */

const SCRIPT = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/base-branch.sh", import.meta.url),
);

// deno-fmt-ignore
const NAMES = [
  "main", "trunk", "release/1.0", "feat_x-2", "9lives", "-x", "--exec=touch", "a..b", ".hidden",
  "a b", "a~1", "a^", "a:b", "_x", "/main", "main/", "x\ty", "é", "a.lock", "A-Z.0/9",
];

async function scriptAnswer(dir: string, name: string): Promise<string | null> {
  const env = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const set = await new Deno.Command("git", {
    args: ["config", "init.defaultBranch", name],
    cwd: dir,
    env,
  }).output();
  if (!set.success) throw new Error(`git config refused ${JSON.stringify(name)}`);
  const out = await new Deno.Command("bash", { args: [SCRIPT], cwd: dir, env, stdout: "piped" })
    .output();
  if (out.code === 3) return null;
  assertEquals(out.code, 0, `base-branch.sh exit for ${JSON.stringify(name)}`);
  return new TextDecoder().decode(out.stdout).replace(/\n$/, "");
}

Deno.test({
  name: "base-branch.sh and plainBranchName print and refuse the same names",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "base-branch-diff-" });
    try {
      await new Deno.Command("git", { args: ["init", "-q"], cwd: dir }).output();
      for (const name of NAMES) {
        assertEquals(plainBranchName(name), await scriptAnswer(dir, name), JSON.stringify(name));
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
