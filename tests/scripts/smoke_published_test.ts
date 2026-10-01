import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * cli#632 — `smoke-published.sh` runs the installed binary end to end. These
 * tests drive it with a fake binary whose behaviour each case controls, so
 * every exit path is observed: the script must say yes only when init
 * succeeded, the scaffold is complete, its lock names THIS release, and
 * `check --project` passes.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPT = `${ROOT}.specnaut/release/smoke-published.sh`;
const POSTFLIGHT = `${ROOT}.specnaut/release/postflight.sh`;

const FILES = [
  "AGENTS.md",
  ".claude/skills/specnaut/SKILL.md",
  ".claude/skills/board/SKILL.md",
  ".claude/skills/ship/SKILL.md",
  ".specnaut/workflow.yml",
];

type Fake = { version?: string; omit?: string; initFails?: boolean; checkFails?: boolean };

async function run(tag: string, fake: Fake): Promise<{ code: number; out: string }> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-smoke-published-" });
  try {
    const bin = join(dir, "fake-specnaut");
    const files = FILES.filter((f) => f !== fake.omit);
    await Deno.writeTextFile(
      bin,
      `#!/usr/bin/env bash
case "$1" in
  init)
    ${fake.initFails ? "echo boom; exit 3" : ""}
    for f in ${files.join(" ")}; do mkdir -p "$(dirname "$f")"; echo x > "$f"; done
    mkdir -p .specnaut
    printf 'version: 2\\ntemplates_version: ${
        fake.version ?? "9.9.9"
      }\\nentries:\\n' > .specnaut/installed.lock
    ;;
  check) ${fake.checkFails ? "echo broken; exit 1" : "exit 0"} ;;
esac
`,
    );
    await Deno.chmod(bin, 0o755);
    const out = await new Deno.Command("bash", { args: [SCRIPT, tag, bin] }).output();
    const dec = new TextDecoder();
    return { code: out.code, out: dec.decode(out.stdout) + dec.decode(out.stderr) };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("passes when init, the scaffold, the lock version and check all hold", async () => {
  const r = await run("v9.9.9", {});
  assertEquals(r.code, 0, r.out);
  assertStringIncludes(r.out, "✓ published binary");
});

Deno.test("fails when init exits non-zero", async () => {
  const r = await run("v9.9.9", { initFails: true });
  assertEquals(r.code, 1);
  assertStringIncludes(r.out, "`specnaut init` exited non-zero");
});

Deno.test("fails when the scaffold is missing a file every run depends on", async () => {
  const r = await run("v9.9.9", { omit: ".specnaut/workflow.yml" });
  assertEquals(r.code, 1);
  assertStringIncludes(r.out, "the scaffold is missing .specnaut/workflow.yml");
});

Deno.test("fails when the binary carries another release's templates", async () => {
  const r = await run("v9.9.9", { version: "9.9.8" });
  assertEquals(r.code, 1);
  assertStringIncludes(r.out, "the lock records templates 9.9.8, expected 9.9.9");
});

Deno.test("fails when check --project rejects a fresh scaffold", async () => {
  const r = await run("v9.9.9", { checkFails: true });
  assertEquals(r.code, 1);
  assertStringIncludes(r.out, "`specnaut check --project` exited non-zero");
});

Deno.test("postflight runs it as a hard failure, and reports a skip as a skip", async () => {
  const src = await Deno.readTextFile(POSTFLIGHT);
  const call = src.indexOf('bash .specnaut/release/smoke-published.sh "$TAG"');
  assert(call > 0, "postflight does not run smoke-published.sh");
  assert(src.indexOf("exit 1", call) - call < 300, "a failed published-binary smoke must exit 1");
  assertStringIncludes(src, "published binary NOT smoke-tested");
  // It must run after the binary is refreshed — before that it is not the published one.
  assert(src.indexOf('echo "▶ refreshing local binary"') < call);
});
