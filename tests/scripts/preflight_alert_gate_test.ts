import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * #653 — the local preflight reads the security alerts the release workflow
 * cannot.
 *
 * `GITHUB_TOKEN` reads code scanning and nothing else, so Dependabot, secret
 * scanning and private advisories gated no release (#527 made the workflow say
 * so). The preflight runs with the operator's own `gh`, which reads all four.
 *
 * These tests extract the block between the `alert-gate` markers and run it
 * against a stubbed `gh`, keyed on the queried path and the severity its jq
 * filter selects, so what is asserted is the script's behaviour.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const PREFLIGHT = `${ROOT}.specnaut/release/preflight.sh`;

async function gateBlock(): Promise<string> {
  // A Windows checkout converts LF to CRLF; bash would read every \r.
  const src = (await Deno.readTextFile(PREFLIGHT)).replaceAll("\r\n", "\n");
  const m = src.match(/# BEGIN alert-gate\n([\s\S]*?)# END alert-gate/);
  assert(m, "preflight.sh has no alert-gate block");
  return m[1];
}

/** What `gh` prints after its jq, one line per page — or `FAIL` for a 4xx. */
type Answer = string;

/**
 * Keys are `<path>:<selection>` — `dependabot/alerts:critical`,
 * `secret-scanning/alerts:all`, `security-advisories:draft`. Anything
 * unlisted answers `0`, a readable source with nothing open.
 */
async function runGate(
  answers: Record<string, Answer>,
  admin = true,
): Promise<{ code: number; out: string }> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-alert-gate-" });
  try {
    const bin = join(dir, "bin");
    await Deno.mkdir(bin);
    const cases = Object.entries(answers)
      .map(([key, a]) =>
        a === "FAIL"
          ? `  ${key}) echo '{"message":"Not Found","status":"404"}'; exit 1 ;;`
          : `  ${key}) printf '%s\\n' ${a.split("\n").map((l) => JSON.stringify(l)).join(" ")} ;;`
      )
      .join("\n");
    await Deno.writeTextFile(
      join(bin, "gh"),
      `#!/usr/bin/env bash
url=""; jq=""
while [ $# -gt 0 ]; do
  case "$1" in --jq) jq="$2"; shift ;; repos/*) url="$1" ;; esac
  shift
done
path="\${url#repos/*/*/}"; base="\${path%%\\?*}"
case "$url" in repos/*/*/*) ;; repos/*) echo "\${GH_ADMIN:-true}"; exit 0 ;; esac
sel=all
case "$jq" in *critical*) sel=critical ;; *high*) sel=high ;; esac
case "$url" in *state=triage*) sel=triage ;; *state=draft*) sel=draft ;; esac
case "$base:$sel" in
${cases}
  *) echo 0 ;;
esac
`,
    );
    await Deno.chmod(join(bin, "gh"), 0o755);
    const script =
      `set -euo pipefail\nsay() { echo "$*"; }\nrepo=specnaut/specnaut-cli\n${await gateBlock()}`;
    const out = await new Deno.Command("bash", {
      args: ["-c", script],
      env: {
        PATH: `${bin}${Deno.build.os === "windows" ? ";" : ":"}${Deno.env.get("PATH")}`,
        GH_ADMIN: String(admin),
      },
    }).output();
    const text = new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr);
    return { code: out.code, out: text };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("every source read and nothing open passes, saying all four were read", async () => {
  const r = await runGate({});
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, "✓ no blocking alert");
  assert(!r.out.includes("could not read"), r.out);
});

Deno.test("an open secret-scanning alert blocks", async () => {
  const r = await runGate({ "secret-scanning/alerts:all": "1" });
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "❌ 1 open secret-scanning alert(s)");
});

Deno.test("a critical Dependabot alert blocks", async () => {
  const r = await runGate({ "dependabot/alerts:critical": "1" });
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "❌ critical alerts open: 1 dependabot + 0 code scanning");
});

Deno.test("a critical code-scanning alert blocks", async () => {
  const r = await runGate({ "code-scanning/alerts:critical": "1" });
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "❌ critical alerts open: 0 dependabot + 1 code scanning");
});

Deno.test("an advisory in triage blocks", async () => {
  const r = await runGate({ "security-advisories:triage": "1" });
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "❌ 1 private advisory report(s) waiting in triage");
});

Deno.test("a draft advisory warns and does not block — its fix has to ship first", async () => {
  const r = await runGate({ "security-advisories:draft": "1" });
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, "! 1 draft advisory(ies)");
});

Deno.test("without admin rights the advisory counts are not trusted", async () => {
  // A non-admin caller gets `[]` — an empty list, not an error — which every
  // count above would read as clean.
  const r = await runGate({}, false);
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "could not read: private_advisories —");
});

Deno.test("the secret-scanning query never asks for the secret itself", async () => {
  const src = await Deno.readTextFile(PREFLIGHT);
  assertStringIncludes(src, "secret-scanning/alerts?state=open&hide_secret=true");
});

Deno.test("high-severity alerts warn and do not block", async () => {
  const r = await runGate({ "dependabot/alerts:high": "2", "code-scanning/alerts:high": "1" });
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, "! high-severity alerts open: 2 dependabot + 1 code scanning");
});

Deno.test("a source that cannot be read blocks, and only that source is named", async () => {
  const r = await runGate({
    "dependabot/alerts:critical": "FAIL",
    "dependabot/alerts:high": "FAIL",
  });
  assertEquals(r.code, 1, r.out);
  const line = r.out.split("\n").find((l) => l.includes("could not read:"));
  assert(line, `no could-not-read line:\n${r.out}`);
  assertStringIncludes(line, "could not read: dependabot —");
  assert(!r.out.includes("✓ no blocking alert"), r.out);
});

Deno.test("an answer that is not a number is unreadable, not zero", async () => {
  const r = await runGate({ "secret-scanning/alerts:all": "null" });
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "could not read: secret_scanning —");
});

Deno.test("counts are summed across pages", async () => {
  // `--paginate` prints one length per page; reading the first page alone
  // would report 0 here and pass a release with two critical alerts.
  const r = await runGate({ "dependabot/alerts:critical": "0\n0\n2" });
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "critical alerts open: 2 dependabot");
});

Deno.test("a blocking finding still says what could not be read", async () => {
  const r = await runGate({
    "code-scanning/alerts:critical": "1",
    "security-advisories:triage": "FAIL",
  });
  assertEquals(r.code, 1, r.out);
  assertStringIncludes(r.out, "critical alerts open");
  assertStringIncludes(r.out, "could not read: private_advisories —");
});
