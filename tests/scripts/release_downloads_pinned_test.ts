import { assert, assertEquals, assertMatch } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parse } from "@std/yaml";

/**
 * Every file a `run:` step of release.yml downloads is pinned by version AND
 * by digest (cli#428).
 *
 * `release_actions_pinned_test.ts` holds every `uses:` to a commit SHA. A
 * `curl` in a `run:` block is the same trust decision with none of that: the
 * signing job downloads `rcodesign` and then hands it the Developer ID key. A
 * `latest` URL, or a versioned one whose bytes nobody checks, lets whoever
 * controls that URL on release day sign as this project.
 *
 * So each download names a version in its URL, the step checks a literal
 * 64-hex sha256 with `sha256sum -c`, and does so before anything is made
 * executable. Values may come from `env:` at the workflow, job or step level;
 * they are resolved before the checks, so moving a pin into `env:` neither
 * hides it nor fails it.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

type Env = Record<string, unknown>;
type Step = { name?: string; run?: string; env?: Env };
type Workflow = { env?: Env; jobs: Record<string, { env?: Env; steps?: Step[] }> };

/** Substitutes `$NAME` and `${NAME}` from the merged env, repeatedly (an env value may name another). */
function resolve(text: string, env: Env): string {
  let out = text;
  for (let i = 0; i < 5; i++) {
    out = out.replace(
      /\$\{?([A-Z_][A-Z0-9_]*)\}?/g,
      (whole, name) => name in env ? String(env[name]) : whole,
    );
  }
  return out;
}

/** Every `run:` step that downloads, with its env resolved. */
async function downloadSteps(): Promise<{ where: string; run: string }[]> {
  const wf = parse(
    await Deno.readTextFile(`${ROOT}.github/workflows/release.yml`),
  ) as Workflow;
  const out = [];
  for (const [job, j] of Object.entries(wf.jobs)) {
    for (const s of j.steps ?? []) {
      if (!s.run || !/\b(curl|wget)\b/.test(s.run)) continue;
      const env = { ...wf.env, ...j.env, ...s.env };
      out.push({ where: `${job} / ${s.name ?? "(unnamed step)"}`, run: resolve(s.run, env) });
    }
  }
  return out;
}

Deno.test("release.yml downloads something, so the pinning scope cannot be empty", async () => {
  const steps = await downloadSteps();
  assert(steps.length > 0, "no run-step download found: the parser is not reading the file");
});

Deno.test("every run-step download names a version in its URL", async () => {
  for (const { where, run } of await downloadSteps()) {
    const urls = run.match(/https?:\/\/[^\s"']+/g) ?? [];
    assert(urls.length > 0, `${where}: downloads from a URL this test cannot read`);
    for (const url of urls) {
      assertMatch(url, /\/v?\d+\.\d+\.\d+\//, `${where}: ${url} is not versioned`);
      assert(!/\/latest\b/.test(url), `${where}: ${url} floats on "latest"`);
    }
  }
});

Deno.test("every run-step download is checked against a literal sha256 before it is made executable", async () => {
  for (const { where, run } of await downloadSteps()) {
    const check = run.search(/sha256sum (-c|--check)/);
    assert(check >= 0, `${where}: the download is never checked with sha256sum -c`);
    assertMatch(run, /\b[0-9a-f]{64}\b/, `${where}: no 64-hex digest is pinned`);
    const chmod = run.search(/chmod \+x/);
    assert(chmod < 0 || chmod > check, `${where}: made executable before it is checked`);
    // The check has to be able to fail: `|| true` or `set +e` around it turns
    // a mismatch into a pass.
    assertEquals(/sha256sum[^\n]*\|\|/.test(run), false, `${where}: a mismatch is swallowed`);
  }
});
