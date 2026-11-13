import { DELIMITER, fromFileUrl, join } from "@std/path";
import { DENO_DIR } from "../integration/spawn_env.ts";

/**
 * A `specnaut` on the PATH of the merge scripts' sandbox (`git_sandbox.ts`) that runs the CLI from
 * source with the permissions `deno task test` grants: `land-feature.sh` asks it to judge HEAD, as
 * a user's installed binary would. Made once per test process.
 */

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));
let bin: string | undefined;

/** `path` with the folder holding the shim first. */
export function withSpecnaut(path: string | undefined): string {
  bin ??= made();
  return path ? `${bin}${DELIMITER}${path}` : bin;
}

/** `env` with the shim first on its PATH, under the name the platform gives that variable. */
export function specnautOnPath(env: Record<string, string>): Record<string, string> {
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  return { ...env, [key]: withSpecnaut(env[key]) };
}

function made(): string {
  const dir = Deno.makeTempDirSync({ prefix: "specnaut-shim-" });
  const flags = "--allow-read --allow-write --allow-run --allow-env";
  Deno.writeTextFileSync(
    join(dir, "specnaut"),
    `#!/usr/bin/env bash\nexport DENO_DIR='${DENO_DIR}'\nexec deno run ${flags} '${MAIN}' "$@"\n`,
  );
  if (Deno.build.os !== "windows") Deno.chmodSync(join(dir, "specnaut"), 0o755);
  globalThis.addEventListener("unload", () => {
    try {
      Deno.removeSync(dir, { recursive: true });
    } catch (e) {
      console.warn(`specnaut_shim: could not remove ${dir}: ${e}`);
    }
  });
  return dir;
}
