import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { bundledScripts, bundleForLock } from "../../src/application/lock_bundle.ts";
import { findHarness } from "../../src/cli/harnesses.ts";
import { parseLock } from "../../src/domain/installed_lock.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { DENO_DIR } from "./spawn_env.ts";
import { commitAll, fixture, git, LOCK, write } from "./verify_scripts_fixture.ts";

/**
 * Review step 1's gate block, taken from the review phase as the bundle renders it and run with
 * this tree's CLI, runs the scope script only when the scripts match the base. The same marker
 * edit is made twice: committed on the base, it runs (the control that proves the edit is live);
 * made on the branch alone, it does not run, and the output names the path.
 */

const SCOPE = ".specnaut/scripts/audit/collect-audit-scope.sh";
const ANCHOR = "<!-- review-gate: verify-scripts -->";
const BUNDLE = bundleForLock(CORE_BUNDLE, parseLock(LOCK), findHarness)!;

/** The bash block right after the anchor in the rendered review phase, its list indent removed. */
function gateBlock(): string {
  const doc = Object.entries(BUNDLE).find(([dest]) =>
    dest.endsWith("skills/task/phases/review.md")
  );
  assert(doc, "the rendered bundle has no review phase");
  const after = doc[1].content.split(ANCHOR)[1];
  assert(after !== undefined, "the review phase lost its gate anchor");
  const m = /^\s*```bash\n([\s\S]*?)\n\s*```/.exec(after);
  assert(m, "no bash block follows the gate anchor");
  return m[1].split("\n").map((l) => l.replace(/^ {3}/, "")).join("\n");
}

/** Every script the bundle installs, the lock beside them: a project as `specnaut init` leaves it. */
function installedScripts(): Record<string, string> {
  return { ".specnaut/installed.lock": LOCK, ...Object.fromEntries(bundledScripts(BUNDLE)) };
}

/** The scope script with a first command that writes the marker. */
const marked = () =>
  installedScripts()[SCOPE].replace("\n", '\nprintf ran > "$REVIEW_GATE_MARKER"\n');

/** A `specnaut` on PATH that is this tree's CLI. */
async function shimDir(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "review-gate-bin-" });
  const main = fromFileUrl(new URL("../../src/main.ts", import.meta.url));
  const shim = join(dir, "specnaut");
  await Deno.writeTextFile(
    shim,
    `#!/bin/sh\nexec deno run --allow-read --allow-write --allow-run --allow-env "${main}" "$@"\n`,
  );
  await Deno.chmod(shim, 0o755);
  return dir;
}

async function runGate(cwd: string) {
  const marker = join(await Deno.makeTempDir({ prefix: "review-gate-marker-" }), "ran");
  const out = await new Deno.Command("bash", {
    args: ["-c", gateBlock()],
    cwd,
    env: {
      PATH: `${await shimDir()}:${Deno.env.get("PATH")}`,
      DENO_DIR,
      REVIEW_GATE_MARKER: marker,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const ran = await Deno.lstat(marker).then(() => true, () => false);
  return { ran, stdout: new TextDecoder().decode(out.stdout) };
}

Deno.test({
  name: "the review gate runs a helper the base carries, and not one only the branch changed",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const onBase = await fixture({ files: { ...installedScripts(), [SCOPE]: marked() } });
    const control = await runGate(onBase.root);
    assertEquals(control.ran, true, `the marker edit must be live:\n${control.stdout}`);

    const onBranch = await fixture({ files: installedScripts() });
    await write(onBranch.root, { [SCOPE]: marked() });
    await commitAll(onBranch.root, "edit the scope script");
    const gated = await runGate(onBranch.root);
    assertEquals(gated.ran, false, "the gate ran a helper only the branch changed");
    assert(gated.stdout.includes(`UNTRUSTED ${SCOPE} differs from base`), gated.stdout);
    assert(gated.stdout.includes("SCRIPTS NOT RUN: verify-scripts exit 1"), gated.stdout);
    assertEquals(await git(onBranch.root, "status", "--porcelain"), "");
  },
});
