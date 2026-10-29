import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * The board-drift detector made three reads per pass and discarded the error
 * from every one of them. Two then substituted an empty value, and an empty
 * value is indistinguishable from a real "nothing to report".
 *
 * The project read at least announced itself — but in the vocabulary of a
 * permanent misconfiguration: `could not read Project #N for owner X`, when
 * the number and the owner were both correct and the cause was a rate limit.
 *
 * The other two are the **false green**. `gh issue list --state closed …
 * || echo '[]'` means a failed read produces "nothing was closed in the
 * window", so the drift set is empty, the summary prints `drifted 0`, and the
 * script exits 0 over a board with any amount of drift. The `scanned 0` guard
 * cannot see it: the project read succeeded, and only the second call failed.
 *
 * That is why the second scenario below is the one that matters. The first
 * fixes a message; the second fixes an answer.
 */

const SCRIPTS = fromFileUrl(
  new URL("../../templates/core/skills/task/scripts/", import.meta.url),
);

type Result = { code: number; out: string; err: string };

/**
 * Run a backend's `sweep-closed.sh` with a stubbed CLI, in the INSTALLED
 * layout — `_config.sh` resolves the project root three levels up from the
 * script and then requires a real `backlog-config.yml`, so running it where it
 * sits in this repository dies with a usage error before reaching a line under
 * test.
 */
async function runSweep(
  backend: "github" | "gitlab",
  bin: string,
  stub: string,
  config: string,
): Promise<Result> {
  const dir = await Deno.makeTempDir({ prefix: `sweep-${backend}-` });
  try {
    const binDir = join(dir, "bin");
    await Deno.mkdir(binDir);
    await Deno.writeTextFile(join(binDir, bin), `#!/usr/bin/env bash\n${stub}\n`);
    await Deno.chmod(join(binDir, bin), 0o755);

    const scripts = join(dir, ".specnaut", "scripts", "backlog");
    await Deno.mkdir(scripts, { recursive: true });
    for await (const e of Deno.readDir(join(SCRIPTS, backend))) {
      if (e.isFile) await Deno.copyFile(join(SCRIPTS, backend, e.name), join(scripts, e.name));
    }
    await Deno.writeTextFile(join(dir, ".specnaut", "backlog-config.yml"), config);

    const { code, stdout, stderr } = await new Deno.Command("bash", {
      args: [join(scripts, "sweep-closed.sh")],
      env: { PATH: `${binDir}:${Deno.env.get("PATH")}`, HOME: dir },
      clearEnv: true,
      stdout: "piped",
      stderr: "piped",
    }).output();

    return {
      code,
      out: new TextDecoder().decode(stdout),
      err: new TextDecoder().decode(stderr),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const GH_CFG = "repo: acme/widgets\nproject_number: 1\n";
const GL_CFG = "host: gitlab.com\nproject_id: acme/widgets\n";

/** One board item, on a repo the scope filter accepts, sitting outside Done. */
const ONE_ITEM = JSON.stringify({
  items: [{
    status: "Ready",
    content: { type: "Issue", number: 42, repository: "acme/widgets" },
  }],
  totalCount: 1,
}).replace(/'/g, "'\\''");

Deno.test("sweep [github]: a failed project read does not blame the configuration", async () => {
  const r = await runSweep(
    "github",
    "gh",
    `echo 'GraphQL: API rate limit already exceeded' >&2; exit 1`,
    GH_CFG,
  );
  assert(r.code !== 0, `a failed read exited 0:\n${r.out}${r.err}`);
  // The tool's own words, so the reader learns what actually happened.
  assertStringIncludes(r.err, "rate limit");
  // And not a claim about facts this run has no evidence against.
  assert(
    !/could not read Project #1 for owner acme$/m.test(r.err),
    `the message still reads as a misconfiguration:\n${r.err}`,
  );
});

Deno.test("sweep [github]: a failed issue read is not an empty board", async () => {
  // THE one that matters. The project read succeeds — so `scanned` is
  // non-zero and the existing `scanned 0` guard stays quiet — and the closed
  // read fails. Before the fix this printed `scanned 1, drifted 0` and
  // exited 0.
  const r = await runSweep(
    "github",
    "gh",
    `case "$*" in
  *"project item-list"*) printf '%s' '${ONE_ITEM}'; exit 0 ;;
  *"issue list"*)        echo 'HTTP 403: rate limit' >&2; exit 1 ;;
  *)                     exit 0 ;;
esac`,
    GH_CFG,
  );
  assert(r.code !== 0, `a failed issue read reported a clean board:\n${r.out}${r.err}`);
  assert(
    !/^scanned \d+, drifted/m.test(r.out),
    `a summary line was printed over a partial read — the summary is the contract:\n${r.out}`,
  );
  assertStringIncludes(r.err, "refusing to report a board state this run never saw");
});

Deno.test("sweep [github]: a genuinely quiet board still reports and exits 0", async () => {
  // The other half. A sweep that failed on everything would satisfy both
  // assertions above and be worthless.
  const r = await runSweep(
    "github",
    "gh",
    `case "$*" in
  *"project item-list"*) printf '%s' '${ONE_ITEM}'; exit 0 ;;
  *"issue list"*)        printf '[]'; exit 0 ;;
  *)                     exit 0 ;;
esac`,
    GH_CFG,
  );
  assertEquals(r.code, 0, `${r.out}${r.err}`);
  assertStringIncludes(r.out, "scanned 1, drifted 0");
});

Deno.test("sweep [github]: real drift is still found", async () => {
  // Item 42 sits in Ready and is closed. The detector must say so — the fix
  // must not achieve its silence by refusing more often.
  const r = await runSweep(
    "github",
    "gh",
    `case "$*" in
  *"project item-list"*) printf '%s' '${ONE_ITEM}'; exit 0 ;;
  *"--state closed"*)    printf '[42]'; exit 0 ;;
  *"issue list"*)        printf '[]'; exit 0 ;;
  *)                     exit 0 ;;
esac`,
    GH_CFG,
  );
  assertStringIncludes(r.out, "DRIFTED");
  assertStringIncludes(r.out, "42");
  assertStringIncludes(r.out, "drifted 1");
});

Deno.test("sweep [gitlab]: a failed issue read is not an empty board", async () => {
  const r = await runSweep(
    "gitlab",
    "glab",
    `echo 'error: 401 unauthorized' >&2; exit 1`,
    GL_CFG,
  );
  assert(r.code !== 0, `a failed read reported a clean board:\n${r.out}${r.err}`);
  assert(
    !/^scanned \d+, drifted/m.test(r.out),
    `a summary line was printed over a partial read:\n${r.out}`,
  );
  assertStringIncludes(r.err, "refusing to report a board state this run never saw");
});

Deno.test("sweep: no read substitutes a value it never obtained", async () => {
  // The behavioural tests are driven by stubs and cannot see which flags the
  // real calls carry. This is the assertion that the substituting idiom is
  // gone from the reads themselves. Comments are stripped: both scripts now
  // quote the idiom they removed, and a raw grep matches its own
  // documentation of the fix.
  for (const backend of ["github", "gitlab"] as const) {
    const src = (await Deno.readTextFile(join(SCRIPTS, backend, "sweep-closed.sh")))
      .split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
    assert(
      !/(gh|glab) issue list[\s\S]{0,400}?\|\|\s*echo '\[\]'/.test(src),
      `${backend}: an issue read still substitutes [] on failure`,
    );
    assert(
      /read_failed/.test(src),
      `${backend}: no read reports its failure`,
    );
  }
});
