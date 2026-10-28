import { assert, assertEquals, assertRejects } from "@std/assert";
import { join, SEPARATOR } from "@std/path";
import { DenoFsReader } from "../../src/infrastructure/fs_reader.ts";
import { parseLock } from "../../src/domain/installed_lock.ts";

/**
 * Registers a test that needs `Deno.symlink`.
 *
 * Windows refuses symlink creation without Developer Mode or elevation, so
 * every fixture in this file fails there for a reason that has nothing to do
 * with the code under test. Registered as IGNORED rather than short-circuited
 * inside the body: a test that returns early reports as PASSED, and a green
 * that never ran is the exact failure this whole feature is about.
 *
 * The consequence is stated rather than hidden: **containment is not covered on
 * Windows.** The code is platform-neutral by construction — `relative()` and
 * `@std/path` throughout, never a hardcoded separator — but that is an argument,
 * not a measurement. `write_bundle_symlink_test.ts` has skipped Windows the same
 * way since before this change.
 */
const WINDOWS = Deno.build.os === "windows";
function symlinkTest(name: string, fn: () => Promise<void>): void {
  Deno.test({ name, ignore: WINDOWS, fn });
}

async function box(): Promise<{ root: string; proj: string; outside: string }> {
  const root = await Deno.makeTempDir({ prefix: "read-" });
  const proj = join(root, "proj");
  const outside = join(root, "outside");
  await Deno.mkdir(proj);
  await Deno.mkdir(outside);
  return { root, proj, outside };
}

symlinkTest("a read through a leaf symlink out of the project is refused", async () => {
  // The exfiltration primitive (cli#574). `DenoFsReader.readText` was three
  // lines with no validator at all, and it is the only `FsReader`. With a
  // bundle destination symlinked out, `specnaut diff` rendered the target's
  // contents as a unified diff on stdout — measured with the real binary.
  const { root, proj, outside } = await box();
  try {
    await Deno.writeTextFile(join(outside, "secret.txt"), "SECRET");
    await Deno.symlink(join(outside, "secret.txt"), join(proj, "c.md"));
    const err = await assertRejects(() => new DenoFsReader().readText(proj, "c.md"));
    assert(err instanceof Error);
    assert(err.message.includes("leaves the project"), err.message);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("a read through a symlinked ancestor is refused", async () => {
  const { root, proj, outside } = await box();
  try {
    await Deno.writeTextFile(join(outside, "secret.txt"), "SECRET");
    await Deno.symlink(outside, join(proj, ".claude"));
    await assertRejects(() => new DenoFsReader().readText(proj, ".claude/secret.txt"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("a traversing relative path is refused by the string rule", async () => {
  const { root, proj } = await box();
  try {
    await assertRejects(() => new DenoFsReader().readText(proj, "../../etc/passwd"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("an ordinary read still works, and a missing file is still null", async () => {
  // The positive control. Every assertion above is a refusal, and a reader
  // that refused everything would satisfy all of them.
  const { root, proj } = await box();
  try {
    await Deno.writeTextFile(join(proj, "ok.md"), "hello");
    assertEquals(await new DenoFsReader().readText(proj, "ok.md"), "hello");
    assertEquals(await new DenoFsReader().readText(proj, "absent.md"), null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("parseLock rejects an entry KEY that is not a legal destination", async () => {
  // The amplifier. Every VALUE in an entry was type-checked and the path it
  // names was not — and the path is the part that reaches the filesystem.
  // `.specnaut/installed.lock` is committed and absent from the scaffolded
  // `.gitignore`, so a cloned repository supplies the key set that `upgrade`
  // then reads off disk, one file per key.
  const hostile = [
    "version: 2",
    "harness: claude",
    "backlog_backend: local",
    "version_scheme: semver",
    "spec_backend: local",
    "templates_version: 4.0.1",
    "entries:",
    "  ../../../../etc/passwd:",
    "    sha256: " + "0".repeat(64),
    "    installed_at: '2026-01-01T00:00:00Z'",
    "    templates_version: 4.0.1",
  ].join("\n");
  const err = await assertRejects(() => Promise.resolve().then(() => parseLock(hostile)));
  assert(err instanceof Error);
  assert(err.message.includes("not a legal destination"), err.message);
});

symlinkTest(
  "a read through a `..` after a link in a link's text is refused (cli#686)",
  async () => {
    const { root, proj, outside } = await box();
    try {
      await Deno.mkdir(join(outside, "deep"));
      await Deno.writeTextFile(join(outside, "secret.txt"), "SECRET");
      await Deno.writeTextFile(join(proj, "secret.txt"), "inside");
      await Deno.symlink(join(outside, "deep"), join(proj, "s"));
      await Deno.symlink(["s", "..", "secret.txt"].join(SEPARATOR), join(proj, "c.md"));
      const err = await assertRejects(() => new DenoFsReader().readText(proj, "c.md"));
      assert(err instanceof Error);
      assert(err.message.includes("leaves the project"), err.message);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);
