import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));
const CONFIG = ".codex/config.toml";

/**
 * cli#599, end to end — `upgrade` must deliver the `[agents]` defaults into a
 * config the user already owns, without touching a line of theirs.
 *
 * The unit tests pin the merge algebra. This pins the thing a user actually
 * experiences: a real `init`, a real hand-edit, a real `upgrade`, and the file
 * on disk afterwards. It is here because the mechanism chosen for this file was
 * a merge block *precisely* to serve people who already keep a
 * `.codex/config.toml` — the normal state for a Codex user, and the population
 * that has the bug. If the delivery only worked on greenfield installs, the fix
 * would miss everyone it was written for.
 */

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

async function codexProject(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-codex-config-" });
  const init = await runSpecnaut(
    ["init", "--here", "--no-git", "--ai", "codex", "--backlog", "local"],
    dir,
  );
  assertEquals(init.code, 0, `init failed: ${init.stderr}`);
  return dir;
}

Deno.test("init scaffolds the agent defaults for a Codex project", async () => {
  const dir = await codexProject();
  try {
    const toml = await Deno.readTextFile(join(dir, CONFIG));
    assertStringIncludes(toml, "[agents]");
    assertStringIncludes(toml, "default_subagent_reasoning_effort");
    // Specnaut names no model version (cli#707).
    assert(!/^\s*default_subagent_model\s*=/m.test(toml), "the block pins a default model");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("upgrade refreshes only the managed block in a hand-edited config", async () => {
  const dir = await codexProject();
  try {
    // The user makes the file their own, on both sides of our block.
    // The block as an earlier release wrote it: with a pinned default model.
    const scaffolded = (await Deno.readTextFile(join(dir, CONFIG))).replace(
      "[agents]\n",
      '[agents]\ndefault_subagent_model = "gpt-5.6-terra"\n',
    );
    const mine =
      `# my own header\napproval_policy = "on-request"\n\n${scaffolded}\n# my own footer\n`;
    // A replace that matched nothing would leave no stale line to remove, and
    // the "did not survive" assertion below would pass on a fresh block.
    assertStringIncludes(mine, 'default_subagent_model = "gpt-5.6-terra"', "fixture is not stale");
    await Deno.writeTextFile(join(dir, CONFIG), mine);

    const up = await runSpecnaut(["upgrade", "--force"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}\n${up.stdout}`);

    const after = await Deno.readTextFile(join(dir, CONFIG));
    assertStringIncludes(after, "# my own header", "the user's leading lines were lost");
    assertStringIncludes(after, 'approval_policy = "on-request"', "a user setting was lost");
    assertStringIncludes(after, "# my own footer", "the user's trailing lines were lost");
    assertStringIncludes(
      after,
      "default_subagent_reasoning_effort",
      "the managed block did not survive",
    );
    assert(
      !after.includes("default_subagent_model"),
      "the stale pinned model survived the upgrade",
    );

    // The failure that makes the file unusable rather than merely wrong.
    assertEquals(
      after.split("[agents]").length - 1,
      1,
      "a second [agents] header was added — the config no longer parses as TOML",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("upgrade refuses, and says so, when the user owns an [agents] table", async () => {
  const dir = await codexProject();
  try {
    // Their own `[agents]`, outside our block — the case where appending would
    // produce a TOML redefinition error.
    await Deno.writeTextFile(
      join(dir, CONFIG),
      "# mine\n[agents]\nmax_concurrent_threads_per_session = 12\n",
    );

    const up = await runSpecnaut(["upgrade", "--force"], dir);
    assertEquals(up.code, 0, "a refusal must not fail the whole upgrade");

    const after = await Deno.readTextFile(join(dir, CONFIG));
    assertEquals(
      after,
      "# mine\n[agents]\nmax_concurrent_threads_per_session = 12\n",
      "the user's config was modified despite the refusal",
    );

    // Silence here would be the same defect wearing a safer coat: the user
    // would keep the bug and never learn the fix had been withheld.
    const out = up.stdout + up.stderr;
    assert(
      out.includes("[agents]") && out.includes("default_subagent_reasoning_effort"),
      `the refusal was not reported, or did not name the keys to add:\n${out}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("upgrade rewrites an agent TOML an earlier release pinned to a model version", async () => {
  const dir = await codexProject();
  try {
    // The file exactly as an earlier release wrote it, and recorded in the lock as
    // such — pristine, not customised — so a plain upgrade must refresh it.
    const rel = ".codex/agents/developer.toml";
    const current = await Deno.readTextFile(join(dir, rel));
    const old = current.replace(/^# Model family: .*\n/, "").replace(
      /^description = .*$/m,
      (line) => `${line}\nmodel = "gpt-5.6-sol"`,
    );
    // Same reason: the upgrade must be shown removing a pin that was there.
    assert(/^model = "gpt-5\.6-sol"$/m.test(old), "fixture is not stale: no pinned model");
    await Deno.writeTextFile(join(dir, rel), old);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(old));
    const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const lockPath = join(dir, ".specnaut/installed.lock");
    const lock = await Deno.readTextFile(lockPath);
    const entry = new RegExp(`(  ${rel.replaceAll(".", "\\.")}:\\n    sha256: )[0-9a-f]{64}`);
    assert(entry.test(lock), "no lock entry for the agent file");
    await Deno.writeTextFile(lockPath, lock.replace(entry, `$1${sha}`));

    const up = await runSpecnaut(["upgrade"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}\n${up.stdout}`);

    const after = await Deno.readTextFile(join(dir, rel));
    assert(!/^model\s*=/m.test(after), `the pinned model survived the upgrade:\n${after}`);
    assert(after.startsWith("# Model family: Sol"), "the family comment was not written");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
