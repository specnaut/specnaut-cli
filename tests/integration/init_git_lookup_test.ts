import { assertEquals } from "@std/assert";
import { DELIMITER, fromFileUrl, join } from "@std/path";
import { exists } from "../helpers/fs_exists.ts";
import { callerPath, plantGit, ran } from "../helpers/planted_git.ts";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));
const TASK_FLAGS = ["--allow-read", "--allow-write", "--allow-run", "--allow-env"];

/**
 * `specnaut init <dir>` run from another folder keeps git's PATH out of `<dir>`'s tree, not the
 * working folder's: the target holds a `git` in `bin`, first on the PATH. Looked up from the
 * working folder, that git would be the one asked whether git is there (it fails), and no
 * repository would be made; on Windows the planted git leaves no mark, and the repository is the
 * proof.
 */
Deno.test("init on a folder other than the working one keeps git's PATH out of that folder", async () => {
  const base = await Deno.realPath(await Deno.makeTempDir({ prefix: "init-git-lookup-" }));
  const [elsewhere, target, fired] = ["elsewhere", "target", "fired"].map((n) => join(base, n));
  try {
    await Deno.mkdir(elsewhere);
    await plantGit(join(target, "bin"), fired);
    const path = [join(target, "bin"), ...callerPath()].join(DELIMITER);
    const { code, said } = await initFrom(elsewhere, target, path);
    assertEquals(code, 0, said);
    assertEquals(await ran(fired), false, "the target's planted git ran");
    assertEquals(await exists(join(target, ".git")), true, said);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

/** `specnaut init <target>` run from `cwd` with `path` as its PATH: its exit, and all it said. */
async function initFrom(cwd: string, target: string, path: string) {
  const init = ["init", target, "--ai", "claude", "--backlog", "local"];
  const args = ["run", ...TASK_FLAGS, MAIN, ...init];
  const piped = { stdout: "piped", stderr: "piped" } as const;
  const out = await new Deno.Command(Deno.execPath(), { args, cwd, env: { PATH: path }, ...piped })
    .output();
  const said = new TextDecoder().decode(out.stderr) + new TextDecoder().decode(out.stdout);
  return { code: out.code, said };
}
