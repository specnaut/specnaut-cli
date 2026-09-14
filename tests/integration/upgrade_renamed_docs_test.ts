import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * Spec 033 — a document that changed address must carry its identity across the
 * move, and a customisation must arrive with it.
 *
 * Release concerns moved from `/specnaut` to `/ship`, so
 * `phases/tag-version.md` became `skills/ship/phases/tag.md`. Without the
 * rename that is two unrelated events: an orphan at the old path and a new file
 * at the new one.
 *
 * **The failure this prevents is not data loss.** A customised orphan is
 * removed only under `--force`, and then with a backup, so the bytes survive
 * either way. They stop being READ: the agent loads the vanilla document at the
 * new address while the user's edit sits at the old one, and the upgrade
 * reports success. If the edit was a guardrail — "never publish without a
 * signed tag" — it is now inert and nothing said so.
 *
 * So these tests assert on CONTENT at the new address, never on existence. A
 * test that only checked the new file exists would pass against exactly the
 * defect this closes.
 */

const OLD_DEST = ".claude/skills/specnaut/phases/tag-version.md";
const NEW_DEST = ".claude/skills/ship/phases/tag.md";

/** A string only the planted customisation can produce. */
const USER_EDIT = "NEVER PUBLISH WITHOUT A SIGNED TAG — house rule, do not remove";

async function runSpecnaut(args: string[], cwd: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A project as it stood before the rename: the old document on disk and in the
 * lock, the new one absent from both. `customise` decides whether the on-disk
 * bytes diverge from the recorded hash.
 */
async function projectBeforeRename(
  dir: string,
  opts: { customise: boolean },
): Promise<void> {
  const init = await runSpecnaut(
    ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"],
    dir,
  );
  assertEquals(init.code, 0, `init failed: ${init.stderr}`);

  const shipped = join(dir, NEW_DEST);
  const vanilla = await Deno.readTextFile(shipped);

  // The old address, as a pre-rename install had it.
  const old = join(dir, OLD_DEST);
  await Deno.mkdir(join(old, ".."), { recursive: true });
  await Deno.writeTextFile(old, opts.customise ? `${vanilla}\n\n${USER_EDIT}\n` : vanilla);

  // The lock records the VANILLA hash either way — that is what makes the
  // customised case diverge and the clean case match, which is the whole
  // discriminator under test. It is YAML, edited as text the way the sibling
  // orphan test does.
  const lockPath = join(dir, ".specnaut/installed.lock");
  const lines = (await Deno.readTextFile(lockPath)).split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    // Drop the new address's block: a pre-rename project had never heard of it.
    if (lines[i].trimEnd() === `  ${NEW_DEST}:`) {
      i++;
      while (i < lines.length && /^\s{4}\S/.test(lines[i])) i++;
      i--;
      continue;
    }
    kept.push(lines[i]);
  }
  const hash = await sha256(vanilla);
  await Deno.writeTextFile(
    lockPath,
    kept.join("\n").replace(/\n*$/, "\n") +
      `  ${OLD_DEST}:\n    sha256: ${hash}\n` +
      `    installed_at: "2026-01-01T00:00:00Z"\n    templates_version: 1.0.0\n`,
  );

  // And the new address does not exist yet.
  await Deno.remove(shipped);
}

Deno.test("a customised document's bytes travel to the new address", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-rename-custom-" });
  try {
    await projectBeforeRename(dir, { customise: true });

    const up = await runSpecnaut(["upgrade"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}\n${up.stdout}`);

    // THE assertion: the user's edit is at the address the agent now reads.
    assert(await exists(join(dir, NEW_DEST)), "the new document was not created");
    assertStringIncludes(
      await Deno.readTextFile(join(dir, NEW_DEST)),
      USER_EDIT,
      "the customisation did not travel — the agent now reads a vanilla document " +
        "while the user's edit sits at the old address, which is the silent " +
        "failure this rename exists to prevent",
    );

    // And it is not left behind as a second copy.
    assertEquals(
      await exists(join(dir, OLD_DEST)),
      false,
      "the old address survived, so the project carries two copies and the " +
        "stale one is the one an old instruction points at",
    );

    // The lock tracks the new address, not the old.
    const lockText = await Deno.readTextFile(join(dir, ".specnaut/installed.lock"));
    assertStringIncludes(lockText, `  ${NEW_DEST}:`, "the lock does not track the new address");
    assert(
      !lockText.includes(`  ${OLD_DEST}:`),
      "the lock still tracks the old address, so the next upgrade sees a phantom orphan",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/**
 * **This one does not prove the rename, and saying so is the point.**
 *
 * For an unmodified document the end state is identical either way: without the
 * rename the old path is a vanilla orphan (removed) and the new one an add-new
 * (written from the template); with it, the file moves and then takes the
 * update. Same bytes, same paths. Verified by probe — disabling the rename
 * leaves this test green and only the customised one red.
 *
 * It earns its place as a regression guard on the vanilla path: the rename must
 * not pin an untouched project to the content it had before the move. The
 * customised test above is the one that has the rename as its only explanation.
 */
Deno.test("an unmodified document is updated at the new address, not preserved", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-rename-clean-" });
  try {
    await projectBeforeRename(dir, { customise: false });

    const up = await runSpecnaut(["upgrade"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}\n${up.stdout}`);

    const moved = await Deno.readTextFile(join(dir, NEW_DEST));
    // The vanilla path must end at the CURRENT template, not at a frozen copy
    // of the old one — otherwise the rename would pin every untouched project
    // to the content it had before the move.
    assertStringIncludes(
      moved,
      "/ship tag",
      "the document at the new address still names the retired command, so the " +
        "clean case carried the old bytes instead of taking the update",
    );
    assertEquals(await exists(join(dir, OLD_DEST)), false, "the old address survived");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
