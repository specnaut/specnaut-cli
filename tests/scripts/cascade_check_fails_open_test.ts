import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * `cascade-check.sh` is a gate, not a report. `phases/merge-close.md` runs it
 * before closing a linked item and again before closing a parent epic, so a
 * false green does not merely misinform — it closes an epic over open work.
 *
 * Three states used to collapse into one `✓ safe to close`:
 *
 *   1. every child genuinely closed — the only safe one;
 *   2. more than one API page of children, the first page all closed — the
 *      call passed neither `--paginate` nor `per_page`;
 *   3. **the query failed** — `2>/dev/null || echo 0` substituted a count it
 *      had never read, so a 403, a rate limit, a revoked scope or a network
 *      blip rendered as a clean verdict. That one needs no epic size at all.
 *
 * The scripts run `gh` and `glab`, so the tests do too — against stubs on
 * PATH. Stubbing is not a convenience here: `glab` is not installed on this
 * machine, and the GitLab twin carried the same defect in a shape no grep for
 * `|| echo 0` would find (`… 2>/dev/null | wc -l`, where the coercion IS the
 * pipe). A fix verified on one backend and reasoned about on the other is the
 * failure this file exists to prevent.
 */

const SCRIPTS = fromFileUrl(
  new URL("../../templates/core/skills/board/scripts/", import.meta.url),
);

type Result = { code: number; out: string; err: string };

/**
 * Run one backend's `cascade-check.sh` with a stubbed CLI.
 *
 * `stub` is the body of a bash script placed on PATH under `bin`. It receives
 * the real argv, so it can answer differently per subcommand — which is what
 * lets the parent lookup succeed while the child enumeration fails, the exact
 * shape that produced the false green.
 */
async function runCheck(
  backend: "github" | "gitlab",
  bin: string,
  stub: string,
  config: string,
  arg = "42",
): Promise<Result> {
  const dir = await Deno.makeTempDir({ prefix: `cascade-${backend}-` });
  try {
    const binDir = join(dir, "bin");
    await Deno.mkdir(binDir);
    await Deno.writeTextFile(join(binDir, bin), `#!/usr/bin/env bash\n${stub}\n`);
    await Deno.chmod(join(binDir, bin), 0o755);

    // The INSTALLED layout, not the template tree's. `_config.sh` resolves the
    // project root from the script's own location — three levels up — and then
    // requires a real `.specnaut/backlog-config.yml`. Running the scripts where
    // they sit in this repository resolves to `templates/core/skills/` and dies
    // with a usage error before reaching a single line under test, which is how
    // the first version of this harness reported nine confident failures about
    // code it had never executed.
    const scripts = join(dir, ".specnaut", "scripts", "backlog");
    await Deno.mkdir(scripts, { recursive: true });
    for await (const e of Deno.readDir(join(SCRIPTS, backend))) {
      if (e.isFile) {
        await Deno.copyFile(join(SCRIPTS, backend, e.name), join(scripts, e.name));
      }
    }
    await Deno.writeTextFile(join(dir, ".specnaut", "backlog-config.yml"), config);

    const { code, stdout, stderr } = await new Deno.Command("bash", {
      args: [join(scripts, "cascade-check.sh"), arg],
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

/** A `gh` stub: the parent resolves as open, and the sub-issues call is yours. */
function ghStub(subIssues: string): string {
  return `
case "$*" in
  *"/issues/42/sub_issues"*) ${subIssues} ;;
  *"/issues/42"*)            printf 'open\\n'; exit 0 ;;
  *)                         exit 0 ;;
esac`;
}

/** 31 children, every one CLOSED — the size that outruns a default page. */
function thirtyOneClosed(): string {
  const rows = Array.from(
    { length: 31 },
    (_, i) => `closed\\t#${100 + i} — child ${i + 1}`,
  ).join("\\n");
  return `printf '${rows}\\n'; exit 0`;
}

/** 31 children, the LAST one open — invisible to an unpaginated first page. */
function thirtyOneLastOpen(): string {
  const rows = Array.from(
    { length: 31 },
    (_, i) => `${i === 30 ? "open" : "closed"}\\t#${100 + i} — child ${i + 1}`,
  ).join("\\n");
  return `printf '${rows}\\n'; exit 0`;
}

const GH_CFG = "repo: acme/widgets\nproject_number: 1\n";
const GL_CFG = "host: gitlab.com\nproject_id: acme/widgets\n";

// ─────────────────────────── the failed query ───────────────────────────

Deno.test("cascade-check [github]: a failed child query is not a clean verdict", async () => {
  // The sharpest of the three states: any parent, at any size, on a bad token.
  const r = await runCheck(
    "github",
    "gh",
    ghStub(`echo 'HTTP 403: rate limit exceeded' >&2; exit 1`),
    GH_CFG,
  );
  assert(r.code !== 0, `a failed enumeration exited 0:\n${r.out}${r.err}`);
  assertEquals(r.code, 3, `expected the "could not answer" exit, got ${r.code}`);
  assert(
    !r.out.includes("safe to close"),
    `a failed query was reported as safe:\n${r.out}`,
  );
  assertStringIncludes(r.err, "refusing to answer");
});

Deno.test("cascade-check [gitlab]: a failed child query is not a clean verdict", async () => {
  const r = await runCheck(
    "gitlab",
    "glab",
    `
case "$*" in
  *"issue view"*) printf '{"state":"opened"}\\n'; exit 0 ;;
  *"issue list"*) echo 'error: 401 unauthorized' >&2; exit 1 ;;
  *)              exit 0 ;;
esac`,
    GL_CFG,
  );
  assert(r.code !== 0, `a failed enumeration exited 0:\n${r.out}${r.err}`);
  assertEquals(r.code, 3, `expected the "could not answer" exit, got ${r.code}`);
  assert(!r.out.includes("safe to close"), `a failed query was reported as safe:\n${r.out}`);
});

// ─────────────────────────── beyond one page ───────────────────────────

Deno.test("cascade-check [github]: an open child past the first page still blocks", async () => {
  // The stub answers with all 31 rows, which is what `--paginate` produces.
  // Without it the script asked for — and got — only the first page.
  const r = await runCheck("github", "gh", ghStub(thirtyOneLastOpen()), GH_CFG);
  assertEquals(r.code, 11, `a child past the page boundary did not block:\n${r.out}${r.err}`);
  assertStringIncludes(r.out, "#130");
  assertStringIncludes(r.out, "1 open child issue(s) of 31");
});

Deno.test("cascade-check [github]: the blocked listing enumerates every open child", async () => {
  // The blocked path used to issue a SECOND unpaginated call to list what it
  // had just counted, so even a correctly-blocked parent under-reported.
  const rows = Array.from({ length: 31 }, (_, i) => `open\\t#${100 + i} — child ${i + 1}`)
    .join("\\n");
  const r = await runCheck("github", "gh", ghStub(`printf '${rows}\\n'; exit 0`), GH_CFG);
  assertEquals(r.code, 11);
  const listed = r.out.split("\n").filter((l) => l.startsWith("  - #")).length;
  assertEquals(listed, 31, `only ${listed} of 31 open children were listed`);
});

Deno.test("cascade-check [github]: 31 closed children are safe, and counted", async () => {
  const r = await runCheck("github", "gh", ghStub(thirtyOneClosed()), GH_CFG);
  assertEquals(r.code, 0, `${r.out}${r.err}`);
  assertStringIncludes(r.out, "all 31 child issue(s) are closed");
});

// ──────────────── the two safe states are different facts ────────────────

Deno.test("cascade-check [github]: no linked children reads differently from all closed", async () => {
  const none = await runCheck("github", "gh", ghStub(`printf ''; exit 0`), GH_CFG);
  assertEquals(none.code, 0, `${none.out}${none.err}`);
  assertStringIncludes(none.out, "no linked children");

  const closed = await runCheck(
    "github",
    "gh",
    ghStub(`printf 'closed\\t#101 — only child\\n'; exit 0`),
    GH_CFG,
  );
  assertEquals(closed.code, 0, `${closed.out}${closed.err}`);
  assertStringIncludes(closed.out, "all 1 child issue(s) are closed");

  assert(
    none.out !== closed.out,
    "an unlinked parent and a fully-closed parent print the same sentence",
  );
});

Deno.test("cascade-check [gitlab]: no linked children reads differently from all closed", async () => {
  const view = `*"issue view"*) printf '{"state":"opened"}\\n'; exit 0 ;;`;
  const none = await runCheck(
    "gitlab",
    "glab",
    `case "$*" in\n  ${view}\n  *"issue list"*) printf '[]\\n'; exit 0 ;;\n  *) exit 0 ;;\nesac`,
    GL_CFG,
  );
  assertEquals(none.code, 0, `${none.out}${none.err}`);
  assertStringIncludes(none.out, "no children labelled");

  const closed = await runCheck(
    "gitlab",
    "glab",
    `case "$*" in\n  ${view}\n  *"issue list"*) printf '[{"iid":101,"title":"only child","state":"closed"}]\\n'; exit 0 ;;\n  *) exit 0 ;;\nesac`,
    GL_CFG,
  );
  assertEquals(closed.code, 0, `${closed.out}${closed.err}`);
  assertStringIncludes(closed.out, "all 1 child issue(s) are closed");
});

Deno.test("cascade-check [gitlab]: an open child blocks and is named", async () => {
  const r = await runCheck(
    "gitlab",
    "glab",
    `case "$*" in
  *"issue view"*) printf '{"state":"opened"}\\n'; exit 0 ;;
  *"issue list"*) printf '[{"iid":101,"title":"a","state":"closed"},{"iid":102,"title":"b","state":"opened"}]\\n'; exit 0 ;;
  *) exit 0 ;;
esac`,
    GL_CFG,
  );
  assertEquals(r.code, 11, `${r.out}${r.err}`);
  assertStringIncludes(r.out, "#102");
  assertStringIncludes(r.out, "1 open child issue(s) of 2");
});

// ─────────────────────── the gate asks for every page ───────────────────────

Deno.test("cascade-check: the API backends ask for a complete enumeration", async () => {
  // The behavioural tests above are driven by stubs, which answer with
  // whatever they are told regardless of the flags they were passed. This is
  // the assertion that the real call would actually fetch beyond page one.
  //
  // Comments are stripped first, and that is not tidiness. Both scripts now
  // carry a comment quoting the idiom they removed — `|| echo 0` in one,
  // the `| wc -l` pipe in the other — so a grep over the raw file matches the
  // documentation of the fix and reports the defect as still present. The
  // first run of this assertion failed for exactly that reason: it could not
  // tell code from the prose describing it.
  const code = (src: string) =>
    src.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");

  const gh = code(await Deno.readTextFile(join(SCRIPTS, "github", "cascade-check.sh")));
  assert(
    /gh api --paginate[\s\S]{0,200}sub_issues/.test(gh),
    "the github sub-issues read is not paginated",
  );
  assert(
    !/\|\|\s*echo 0/.test(gh),
    "a count is still being substituted for one that was never read",
  );

  const gl = code(await Deno.readTextFile(join(SCRIPTS, "gitlab", "cascade-check.sh")));
  assert(/--per-page/.test(gl), "the gitlab child listing has no explicit page size");
  assert(
    !/wc -l/.test(gl),
    "the gitlab count is still a line count of a discarded-stderr pipe",
  );
});

// ───────── misuse is not unreadability, and absence is not either ─────────
//
// Exit 3 is the code `phases/merge-close.md` teaches callers to read as "the
// gate could not see — a token, scope or network problem, not a verdict". It
// was also what you got for a typo and for an issue that does not exist. Three
// different events, one code, one sentence.
//
// The second one is the interesting one. `gh api` writes the API's error body
// to STDOUT on a 404, so the not-found branch — which tested the output for
// emptiness — could not fire, and control fell through to the child
// enumeration, whose failure spoke for a parent that was never there.

/** A `gh` stub whose parent lookup fails the way the real one does on a 404. */
const GH_PARENT_404 = `
case "$*" in
  *"/issues/42/sub_issues"*) echo 'HTTP 404: Not Found' >&2; exit 1 ;;
  *"/issues/42"*)            printf '%s' '{"message":"Not Found","documentation_url":"https://docs.github.com/rest","status":"404"}'; exit 1 ;;
  *)                         exit 0 ;;
esac`;

/** A `gh` stub whose parent lookup fails for a reason that is NOT absence. */
const GH_PARENT_403 = `
case "$*" in
  *"/issues/42/sub_issues"*) echo 'HTTP 403' >&2; exit 1 ;;
  *"/issues/42"*)            echo 'HTTP 403: rate limit exceeded' >&2; exit 1 ;;
  *)                         exit 0 ;;
esac`;

Deno.test("cascade-check [github]: a non-numeric argument is a usage error, not a refusal", async () => {
  const r = await runCheck("github", "gh", ghStub(`printf ''; exit 0`), GH_CFG, "banana");
  assertEquals(r.code, 2, `a malformed argument did not exit 2:\n${r.out}${r.err}`);
  assertStringIncludes(r.err, "banana");
  assert(
    !r.err.includes("could not read the children"),
    `a caller's own typo was reported as an unreadable world:\n${r.err}`,
  );
});

Deno.test("cascade-check [gitlab]: a non-numeric argument is a usage error, not a refusal", async () => {
  const r = await runCheck("gitlab", "glab", `exit 0`, GL_CFG, "--repo");
  assertEquals(r.code, 2, `a malformed argument did not exit 2:\n${r.out}${r.err}`);
  assertStringIncludes(r.err, "--repo");
  assert(
    !r.err.includes("could not read the children"),
    `a caller's own typo was reported as an unreadable world:\n${r.err}`,
  );
});

Deno.test("cascade-check [github]: a missing issue says so, and does not blame the children", async () => {
  const r = await runCheck("github", "gh", GH_PARENT_404, GH_CFG);
  assertEquals(r.code, 3, `${r.out}${r.err}`);
  assertStringIncludes(r.err, "not found");
  assert(
    !r.err.includes("could not read the children"),
    `an issue that does not exist was reported as an unreadable child list:\n${r.err}`,
  );
});

Deno.test("cascade-check [github]: a parent read that fails for another reason does not claim absence", async () => {
  // The mirror of the test above, and the reason the fix reads the 404 body
  // rather than simply treating every failed parent read as "not found":
  // asserting the issue does not exist over a revoked token is the same
  // invented certainty, pointed the other way.
  const r = await runCheck("github", "gh", GH_PARENT_403, GH_CFG);
  assertEquals(r.code, 3, `${r.out}${r.err}`);
  assertStringIncludes(r.err, "could not read issue");
  assert(
    !r.err.includes("not found"),
    `a rate limit was reported as a missing issue:\n${r.err}`,
  );
});

Deno.test("cascade-check: every backend rejects a non-number before it reaches its backend", async () => {
  // `local` and `cloud` already carried this guard; the two API-backed ones did
  // not, which is the asymmetry that let an argument become a lookup. Asserted
  // over all four so a future backend inherits the requirement rather than the
  // omission.
  const backends = ["github", "gitlab", "local", "cloud"];
  const missing: string[] = [];
  for (const b of backends) {
    const src = await Deno.readTextFile(join(SCRIPTS, b, "cascade-check.sh"));
    const code = src.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
    if (!/case "\$NUM" in[\s\S]{0,120}\*\[!0-9\]\*\)[\s\S]{0,120}exit 2/.test(code)) {
      missing.push(b);
    }
  }
  assertEquals(missing, [], `backends accepting a non-number as an issue id: ${missing}`);
});
