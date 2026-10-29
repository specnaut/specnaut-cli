import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * The hook-trust note end to end (US6, FR-012): Codex runs project hooks only
 * once the user trusts them, and again after any change to what it hashed. So
 * `init` and `upgrade` say so exactly when a run changed `.codex/hooks.json` or
 * a file under `.specnaut/hooks/` — never on a no-op run, never on a harness
 * that does not hash its hooks.
 */

const NOTE = "Codex runs project hooks only once you trust them: open Codex here and run /hooks";
const FOREIGN = "./tools/acme-lint.sh --strict";
const CUSTOMIZED = ".specnaut/hooks/guard-merge.sh";

async function runSpecnaut(args: string[], cwd: string, home: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    env: { HOME: home, NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { code, out: d.decode(stdout) + d.decode(stderr) };
}

/** Init a fresh project on `ai`, hand `body` the init output, and clean up whatever happens. */
async function withProject(
  ai: "codex" | "claude",
  body: (dir: string, home: string, initOut: string) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-trust-" });
  const home = await Deno.makeTempDir({ prefix: "specnaut-home-" });
  try {
    const init = await runSpecnaut(
      ["init", "--here", "--no-git", "--ai", ai, "--backlog", "local"],
      dir,
      home,
    );
    assertEquals(init.code, 0, init.out);
    await body(dir, home, init.out);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
}

/** Drop the first `PreToolUse` group Specnaut registered, and add one command of the user's. */
async function editRegistry(dir: string, rel: string): Promise<void> {
  const path = join(dir, rel);
  const json = JSON.parse(await Deno.readTextFile(path));
  json.hooks.PreToolUse.shift();
  json.hooks.Stop = [...(json.hooks.Stop ?? []), {
    hooks: [{ type: "command", command: FOREIGN }],
  }];
  await Deno.writeTextFile(path, JSON.stringify(json, null, 2));
}

Deno.test("codex init prints the trust note with the hooks it registered", async () => {
  await withProject("codex", (_dir, _home, out) => {
    assertStringIncludes(out, NOTE);
    assertStringIncludes(
      out,
      "Until then the merge, release, generated-file, constitution and model guards",
    );
    assertStringIncludes(out, "Specnaut's hooks: approve-on-prompt.sh, guard-dispatch-model.sh");
    assert(!out.includes("not installed by Specnaut"), out);
    return Promise.resolve();
  });
});

Deno.test("claude init and upgrade never print the trust note", async () => {
  await withProject("claude", async (dir, home, out) => {
    assert(!out.includes(NOTE), out);
    await editRegistry(dir, ".claude/settings.json");
    await Deno.writeTextFile(join(dir, CUSTOMIZED), "#!/usr/bin/env bash\nexit 0\n");
    const up = await runSpecnaut(["upgrade"], dir, home);
    assertEquals(up.code, 0, up.out);
    assert(!up.out.includes(NOTE), up.out);
    assert(!up.out.includes("SHA256SUMS"), up.out);
  });
});

Deno.test("a codex upgrade that changes nothing prints no trust note", async () => {
  await withProject("codex", async (dir, home) => {
    const up = await runSpecnaut(["upgrade"], dir, home);
    assertEquals(up.code, 0, up.out);
    assertStringIncludes(up.out, "already up to date");
    assert(!up.out.includes(NOTE), up.out);
  });
});

Deno.test("a codex upgrade that re-merges hooks.json prints the note and names a foreign entry", async () => {
  await withProject("codex", async (dir, home) => {
    await editRegistry(dir, ".codex/hooks.json");
    const up = await runSpecnaut(["upgrade"], dir, home);
    assertEquals(up.code, 0, up.out);
    assertStringIncludes(up.out, NOTE);
    assertStringIncludes(
      up.out,
      `⚠ ${FOREIGN} — not installed by Specnaut — review before trusting`,
    );
  });
});

Deno.test("a customized hook file is named until --force restores the folder", async () => {
  await withProject("codex", async (dir, home) => {
    const path = join(dir, CUSTOMIZED);
    await Deno.writeTextFile(path, (await Deno.readTextFile(path)) + "# my tweak\n");
    const kept = await runSpecnaut(["upgrade"], dir, home);
    assertEquals(kept.code, 0, kept.out);
    assertStringIncludes(
      kept.out,
      `⚠ ${CUSTOMIZED} is customized: Codex CLI will refuse to run any Specnaut hook until ` +
        "the folder matches its SHA256SUMS again (`specnaut upgrade --force` restores it).",
    );
    const forced = await runSpecnaut(["upgrade", "--force"], dir, home);
    assertEquals(forced.code, 0, forced.out);
    assert(!forced.out.includes("is customized:"), forced.out);
    // `--force` rewrote a file Codex hashes: the trust has to be given again.
    assertStringIncludes(forced.out, NOTE);
  });
});

/** A project init'ed by the release before: its hook file is untouched, the bundle's is newer. */
async function outdateHook(dir: string, rel: string): Promise<void> {
  const old = "#!/usr/bin/env bash\n# the previous release's copy\nexit 0\n";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(old));
  const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  await Deno.writeTextFile(join(dir, rel), old);
  const lockPath = join(dir, ".specnaut/installed.lock");
  const lock = await Deno.readTextFile(lockPath);
  const at = lock.indexOf(`  ${rel}:\n    sha256: `);
  assert(at >= 0, `the lock does not track ${rel}`);
  const start = at + `  ${rel}:\n    sha256: `.length;
  await Deno.writeTextFile(lockPath, lock.slice(0, start) + sha + lock.slice(start + 64));
}

Deno.test("a codex upgrade that rewrites an outdated Specnaut hook tells the user to trust it again", async () => {
  // Spec 038, FR-016: a release that changes the hooks (the constitution guard)
  // leaves every Codex guard off until re-trusted, and the upgrade must say so.
  await withProject("codex", async (dir, home) => {
    await outdateHook(dir, CUSTOMIZED);
    const up = await runSpecnaut(["upgrade"], dir, home);
    assertEquals(up.code, 0, up.out);
    assertStringIncludes(up.out, CUSTOMIZED);
    assertStringIncludes(up.out, NOTE);
    assert(!up.out.includes("is customized:"), up.out);
  });
});
