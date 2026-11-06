import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";

/**
 * A project 9.0 left, upgraded by the real CLI: the approval hooks, their
 * helpers and the merge hold are on disk and in the lock, registered, with the
 * release ask rules in Claude's settings. Nothing is left of them afterwards,
 * by hand or otherwise, and what the user added stays.
 *
 * The 9.0 state is a fresh init plus those files: each is recorded in the lock
 * with protect-generated's own hash and given its content, so `upgrade` reads
 * them as unchanged Specnaut files, not as the user's.
 */

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));
const SETTINGS = { claude: ".claude/settings.json", codex: ".codex/hooks.json" } as const;
const GUARD = ".specnaut/hooks/protect-generated.sh";
const SCRIPTS = ["guard-merge", "guard-release", "protect-constitution", "approve-on-prompt"];
const RETIRED = [
  ...SCRIPTS.map((s) => `.specnaut/hooks/${s}.sh`),
  ".specnaut/hooks/merge-approved.sh",
  ".specnaut/hooks/_approval.sh",
  ".specnaut/hooks/_baseline.sh",
  ".specnaut/hooks/_command.sh",
  ".specnaut/hooks/_simple.sh",
  ".specnaut/hooks/_git.sh",
  ".specnaut/hooks/_listed.sh",
  ".specnaut/hooks/merge-commands.txt",
  ".specnaut/hooks/release-commands.txt",
  ".specnaut/scripts/bash/merge-hold.sh",
];
const ASK = ["Bash(gh release create *)", "Bash(*release/tag.sh*)", "Bash(gh release new *)"];
/** The read-deny rules every upgrade merges into Claude's settings, as shipped. */
const DENY: string[] = JSON.parse(
  Deno.readTextFileSync(
    fromFileUrl(new URL("../../templates/harness-specific/claude/settings.json", import.meta.url)),
  ),
).permissions.deny;

async function runSpecnaut(args: string[], cwd: string, home: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    env: { HOME: home },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { code, out: d.decode(stdout) + d.decode(stderr) };
}

type Group = { matcher?: string; hooks: { type: string; command: string }[] };

/** The registration of `script` on `harness`, spelled as the bundle spells a sibling's. */
function registration(sibling: string, script: string): { type: string; command: string } {
  return { type: "command", command: sibling.replace("protect-generated.sh", `${script}.sh`) };
}

for (const harness of ["claude", "codex"] as const) {
  Deno.test(`upgrade from 9.0 removes the approval hooks (${harness})`, async () => {
    const dir = await Deno.makeTempDir({ prefix: "specnaut-hooks90-" });
    const home = await Deno.makeTempDir({ prefix: "specnaut-home-" });
    try {
      const git = await new Deno.Command("git", { args: ["init", "-q", "-b", "main"], cwd: dir })
        .output();
      assertEquals(git.code, 0);
      const init = await runSpecnaut(
        ["init", "--here", "--ai", harness, "--backlog", "local"],
        dir,
        home,
      );
      assertEquals(init.code, 0, init.out);

      const content = await Deno.readTextFile(join(dir, GUARD));
      const lockPath = join(dir, ".specnaut/installed.lock");
      const lock = await Deno.readTextFile(lockPath);
      const entry = new RegExp(`^ {2}${GUARD.replaceAll(".", "\\.")}:\\n(?: {4}.*\\n)*`, "m")
        .exec(lock)?.[0];
      assert(entry !== undefined, "the lock tracks the guard");
      let added = "";
      for (const f of RETIRED) {
        await Deno.writeTextFile(join(dir, f), content);
        added += entry.replace(GUARD, f);
      }
      await Deno.writeTextFile(lockPath, lock.replace(entry, entry + added));

      const path = join(dir, SETTINGS[harness]);
      const file = JSON.parse(await Deno.readTextFile(path));
      const guard: Group = file.hooks.PreToolUse.find((g: Group) =>
        g.hooks.some((h) => h.command.includes("protect-generated.sh"))
      );
      const sibling = guard.hooks[0].command;
      file.hooks.PreToolUse.push({
        matcher: "Bash",
        hooks: [
          ...SCRIPTS.slice(0, 3).map((s) => registration(sibling, s)),
          { type: "command", command: "./my-check.sh" },
        ],
      });
      file.hooks.UserPromptSubmit = [{ hooks: [registration(sibling, "approve-on-prompt")] }];
      file.hooks.Stop = [{ hooks: [registration(sibling, "approve-on-prompt")] }];
      if (harness === "claude") file.permissions = { allow: ["Read"], ask: [...ASK, "Bash(mine)"] };
      await Deno.writeTextFile(path, `${JSON.stringify(file, null, 2)}\n`);

      const up = await runSpecnaut(["upgrade"], dir, home);
      assertEquals(up.code, 0, up.out);

      for (const f of RETIRED) assertEquals(await exists(join(dir, f)), false, `${f} stays`);
      const lockAfter = await Deno.readTextFile(lockPath);
      for (const f of RETIRED) assertEquals(lockAfter.includes(f), false, `${f} is still locked`);

      const text = await Deno.readTextFile(path);
      for (const s of SCRIPTS) {
        assertEquals(text.includes(`${s}.sh`), false, `${s} still registered`);
      }
      const after = JSON.parse(text);
      const commands = Object.values(after.hooks as Record<string, Group[]>)
        .flat().flatMap((g) => g.hooks.map((h) => h.command));
      assert(commands.includes("./my-check.sh"), "the user's hook is theirs");
      assert(commands.some((c) => c.includes("protect-generated.sh")), "the lock guard stays");
      assertEquals(after.hooks.UserPromptSubmit, undefined);
      assertEquals(after.hooks.Stop, undefined);
      if (harness === "claude") {
        assertEquals(after.permissions, { allow: ["Read"], ask: ["Bash(mine)"], deny: DENY });
      }

      const again = await runSpecnaut(["upgrade"], dir, home);
      assertEquals(again.code, 0, again.out);
      assertEquals(await Deno.readTextFile(path), text, "a second upgrade changes nothing");
    } finally {
      await Deno.remove(dir, { recursive: true });
      await Deno.remove(home, { recursive: true });
    }
  });
}
