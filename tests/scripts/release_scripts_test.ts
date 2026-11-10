import { assert } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parse } from "@std/yaml";

/**
 * Release steps whose shell lives in `scripts/release/` instead of inline.
 *
 * `no_secrets_in_public_repo_test.ts` reads the `run:` blocks of release.yml
 * for the shapes that pushed outward with a stored credential. A step that runs
 * a script shows that guard one line, `bash scripts/release/…`, and none of the
 * script. This reads through to every script release.yml runs, so moving shell
 * into a file never moves it out of sight.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

type Workflow = { jobs: Record<string, { steps?: { run?: string }[] }> };

async function releaseScripts(): Promise<string[]> {
  const wf = parse(
    await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`),
  ) as Workflow;
  const runs = Object.values(wf.jobs).flatMap((j) => j.steps ?? []).map((s) => s.run ?? "");
  return [...runs.join("\n").matchAll(/\bbash (scripts\/\S+\.sh)/g)].map((m) => m[1]);
}

Deno.test("every script release.yml runs pushes to no other repository", async () => {
  const scripts = await releaseScripts();
  assert(scripts.length > 0, "release.yml runs no repository script — re-check what this reads");
  for (const file of scripts) {
    const text = await Deno.readTextFile(`${ROOT}${file}`);
    for (const forbidden of ["gh repo clone", "git push", "sync-to-", "bump-tap-"]) {
      assert(
        !text.includes(forbidden),
        `${file} runs '${forbidden}' — publishing outward from a public repo needs a ` +
          `stored credential, which this repository does not hold`,
      );
    }
  }
});
