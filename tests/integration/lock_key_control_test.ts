import { assert, assertNotEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * A committed `installed.lock` is the repository's, not the user's (cli#574), so
 * a key in it can carry an escape sequence. Its refusal reaches the user's
 * terminal through the real binary (cli#776): it is refused, and shown escaped.
 */

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/** The key, in YAML's double-quoted escapes: ESC, BEL, a C1 CSI and DEL. */
const KEY_YAML = `"a\\u001b]0;pwned\\u0007\\u009b2J\\u007fb.md"`;

const LOCK = `version: 2
harness: claude
templates_version: 0.0.1
entries:
  ${KEY_YAML}:
    sha256: x
    installed_at: '2026-01-01T00:00:00.000Z'
    templates_version: 0.0.1
`;

// deno-lint-ignore no-control-regex
const RAW_CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;

Deno.test("a lock key with control characters is refused, escaped, on stderr", async () => {
  const proj = await Deno.makeTempDir({ prefix: "lock-key-control-" });
  try {
    await Deno.mkdir(join(proj, ".specnaut"));
    await Deno.writeTextFile(join(proj, ".specnaut/installed.lock"), LOCK);
    const out = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-run",
        "--allow-env",
        MAIN,
        "reconcile",
        "--status",
      ],
      cwd: proj,
      env: { NO_COLOR: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(out.stderr);
    assertNotEquals(out.code, 0, "the lock was accepted");
    // The marker only this refusal prints, so a crash elsewhere cannot pass.
    assertStringIncludes(stderr, "is not a legal destination");
    assertStringIncludes(stderr, "a\\u001b]0;pwned\\u0007\\u009b2J\\u007fb.md");
    assert(!RAW_CONTROL.test(stderr), `raw control on stderr: ${JSON.stringify(stderr)}`);
  } finally {
    await Deno.remove(proj, { recursive: true });
  }
});
