import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * The preflight's workflow gate asks for BOTH `ci` and `smoke` on HEAD.
 *
 * `smoke.yml` runs the whole smoke suite against the exact commit, yet the
 * gate used to ask only about `ci`: a red smoke run would not stop a tag.
 * These tests extract the block between the `workflow-gate` markers and run
 * it against a stubbed `gh` that answers per workflow, so what is asserted is
 * the script's behaviour, not its wording.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const PREFLIGHT = `${ROOT}.specnaut/release/preflight.sh`;

async function gateBlock(): Promise<string> {
  // A Windows checkout converts LF to CRLF; the markers are matched on LF, and
  // bash would read a trailing \r on every line of the extracted block.
  const src = (await Deno.readTextFile(PREFLIGHT)).replaceAll("\r\n", "\n");
  const m = src.match(/# BEGIN workflow-gate\n([\s\S]*?)# END workflow-gate/);
  assert(m, "preflight.sh has no workflow-gate block");
  return m[1];
}

/** `answers` maps a workflow name to the conclusion `gh` reports for it. */
async function runGate(
  answers: Record<string, string>,
): Promise<{ code: number; out: string; asked: string[] }> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-preflight-gate-" });
  try {
    const bin = join(dir, "bin");
    await Deno.mkdir(bin);
    const log = join(dir, "asked");
    const cases = Object.entries(answers)
      .map(([wf, c]) => `    ${wf}) echo ${JSON.stringify(c)} ;;`)
      .join("\n");
    await Deno.writeTextFile(
      join(bin, "gh"),
      `#!/usr/bin/env bash
wf=""; while [ $# -gt 0 ]; do [ "$1" = "--workflow" ] && wf="$2"; shift; done
echo "$wf" >> ${JSON.stringify(log)}
case "$wf" in
${cases}
    *) echo "" ;;
esac
`,
    );
    await Deno.writeTextFile(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
    await Deno.chmod(join(bin, "gh"), 0o755);
    await Deno.chmod(join(bin, "sleep"), 0o755);
    const script = `set -euo pipefail\nsay() { echo "$*"; }\nsha=abc123\n${await gateBlock()}`;
    const out = await new Deno.Command("bash", {
      args: ["-c", script],
      env: { PATH: `${bin}${Deno.build.os === "windows" ? ";" : ":"}${Deno.env.get("PATH")}` },
    }).output();
    const asked = (await Deno.readTextFile(log).catch(() => "")).trim().split("\n");
    const text = new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr);
    return { code: out.code, out: text, asked };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("preflight passes only when both ci and smoke are green on HEAD", async () => {
  const r = await runGate({ ci: "success", smoke: "success" });
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, "✓ ci green");
  assertStringIncludes(r.out, "✓ smoke green");
});

Deno.test("a red smoke run stops the preflight, naming the workflow", async () => {
  const r = await runGate({ ci: "success", smoke: "failure" });
  assertEquals(r.code, 1);
  assertStringIncludes(r.out, "❌ smoke not green on abc123 (got: failure)");
});

Deno.test("a red ci run stops the preflight before smoke is asked", async () => {
  const r = await runGate({ ci: "failure", smoke: "success" });
  assertEquals(r.code, 1);
  assertStringIncludes(r.out, "❌ ci not green");
  assert(!r.asked.includes("smoke"), `smoke was queried after ci failed: ${r.asked}`);
});

Deno.test("a smoke run that never completes is a failure, not a pass", async () => {
  const r = await runGate({ ci: "success" });
  assertEquals(r.code, 1);
  assertStringIncludes(r.out, "❌ smoke not green on abc123 (got: no-completed-run-after-10min)");
});
