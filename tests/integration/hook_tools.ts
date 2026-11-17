import { join } from "@std/path";

/**
 * A PATH for a hook under test that names only the tools it runs. The hooks drop a PATH entry
 * inside the project, relative or empty, so a test PATH carried over from the developer's shell
 * would decide cases no test set; and a folder the tools come from may hold a `specnaut` too.
 */

/** Makes `<dir>/tools` holding `names`, each a link to the one the current PATH finds. */
export async function toolsIn(dir: string, names: readonly string[]): Promise<string> {
  const tools = join(dir, "tools");
  await Deno.mkdir(tools);
  for (const name of names) {
    const out = await new Deno.Command("bash", { args: ["-c", `command -v ${name}`] }).output();
    await Deno.symlink(new TextDecoder().decode(out.stdout).trim(), join(tools, name));
  }
  return tools;
}

/** What the hooks and their stubs run: the hooks' own commands, and the stubs' `env bash`. */
export const HOOK_TOOLS = ["bash", "cat", "env", "git", "rm", "dirname", "readlink"] as const;

let shared: Promise<string> | undefined;

/** One tools folder for the whole test process, removed when it ends. */
export function hookTools(): Promise<string> {
  shared ??= (async () => {
    const dir = await Deno.makeTempDir({ prefix: "hook-tools-" });
    globalThis.addEventListener("unload", () => Deno.removeSync(dir, { recursive: true }));
    return await toolsIn(dir, HOOK_TOOLS);
  })();
  return shared;
}
