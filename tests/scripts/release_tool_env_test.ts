import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parse } from "@std/yaml";

/**
 * `rcodesign` reads every `RCODESIGN_*` environment variable as a key of its own configuration
 * and refuses a key it does not know. The v9.4.0 tag's signing job exported the tool's download
 * URL and digest as `RCODESIGN_URL` / `RCODESIGN_SHA256`, so `rcodesign sign` stopped at
 * `UnknownField("sha256")` before signing anything, and nothing was published. No env value of
 * release.yml, at the workflow, job or step level, may carry that prefix.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const TOOL_CONFIG_PREFIX = "RCODESIGN_";

type Env = Record<string, unknown>;
type Workflow = { env?: Env; jobs: Record<string, { env?: Env; steps?: { env?: Env }[] }> };

function envKeys(wf: Workflow): string[] {
  const scopes = [
    wf.env,
    ...Object.values(wf.jobs).flatMap((j) => [j.env, ...(j.steps ?? []).map((s) => s.env)]),
  ];
  return scopes.flatMap((env) => Object.keys(env ?? {}));
}

Deno.test("release.yml exports no variable rcodesign would read as its own configuration", async () => {
  const wf = parse(await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`)) as Workflow;
  const keys = envKeys(wf);
  assertEquals(
    keys.includes("MACOS_TEAM_ID"),
    true,
    "the env walk found none of release.yml's variables",
  );
  assertEquals(keys.filter((k) => k.startsWith(TOOL_CONFIG_PREFIX)), []);
});
