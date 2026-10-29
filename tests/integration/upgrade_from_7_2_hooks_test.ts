import { assert, assertEquals } from "@std/assert";
import { encodeHex } from "@std/encoding/hex";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";
import { lockText } from "./_lock_fixture.ts";

/**
 * Spec 038 T027: a project 7.2 left — every hook it shipped registered, no
 * `protect-constitution.sh`, no `_baseline.sh` — upgraded by the real CLI.
 * The new guard must arrive installed, executable and registered once in each
 * group the bundle puts it in, beside the hooks already there; on Codex every
 * command must pin the hash of the `SHA256SUMS` now on disk, so the changed
 * folder asks for trust again instead of refusing every call.
 *
 * The 7.2 state is the bundle's own registrations minus the new guard, read
 * from a fresh init: the oracle is the bundle, not the merge under test.
 */

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));
const NEW = [".specnaut/hooks/protect-constitution.sh", ".specnaut/hooks/_baseline.sh"];
const SETTINGS = { claude: ".claude/settings.json", codex: ".codex/hooks.json" } as const;

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

type Group = { matcher?: string; hooks: { command: string }[] };
type Reg = { event: string; matcher: string | undefined; command: string };

function registrations(file: { hooks?: Record<string, Group[]> }): Reg[] {
  return Object.entries(file.hooks ?? {}).flatMap(([event, groups]) =>
    groups.flatMap((g) => g.hooks.map((h) => ({ event, matcher: g.matcher, command: h.command })))
  );
}

/** `file` without any entry running the new guard, empty groups dropped. */
function as72(file: { hooks: Record<string, Group[]> }) {
  const hooks: Record<string, Group[]> = {};
  for (const [event, groups] of Object.entries(file.hooks)) {
    hooks[event] = groups
      .map((g) => ({
        ...g,
        hooks: g.hooks.filter((h) => !h.command.includes("protect-constitution")),
      }))
      .filter((g) => g.hooks.length > 0);
  }
  return { ...file, hooks };
}

for (const harness of ["claude", "codex"] as const) {
  Deno.test(`upgrade from 7.2 installs and registers protect-constitution once (${harness})`, async () => {
    const dir = await Deno.makeTempDir({ prefix: "specnaut-hooks72-" });
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
      const path = join(dir, SETTINGS[harness]);
      const bundled = registrations(JSON.parse(await Deno.readTextFile(path)));
      const ours = bundled.filter((r) => r.command.includes("protect-constitution.sh"));
      assertEquals(ours.length, 2, `${harness}: one Edit and one Bash registration`);

      await Deno.writeTextFile(
        path,
        `${JSON.stringify(as72(JSON.parse(await Deno.readTextFile(path))), null, 2)}\n`,
      );
      const lock = (await lockText(dir)).replace(
        /^ {2}\.specnaut\/hooks\/(protect-constitution|_baseline)\.sh:\n(?: {4}.*\n)*/gm,
        "",
      );
      await Deno.writeTextFile(join(dir, ".specnaut/installed.lock"), lock);
      for (const f of NEW) await Deno.remove(join(dir, f));

      const up = await runSpecnaut(["upgrade"], dir, home);
      assertEquals(up.code, 0, up.out);
      for (const f of NEW) assert(await exists(join(dir, f)), `${harness}: ${f} not installed`);
      const mode = (await Deno.stat(join(dir, NEW[0]))).mode;
      if (Deno.build.os !== "windows") assert((mode! & 0o111) !== 0, "the guard is executable");

      const after = registrations(JSON.parse(await Deno.readTextFile(path)));
      for (const b of bundled) {
        const same = after.filter((r) =>
          r.event === b.event && r.matcher === b.matcher && r.command === b.command
        );
        assertEquals(same.length, 1, `${harness}: ${b.event} ${b.matcher} \`${b.command}\``);
      }
      assertEquals(after.length, bundled.length, `${harness}: a stale or duplicated entry`);

      if (harness === "codex") {
        const sums = await Deno.readFile(join(dir, ".specnaut/hooks/SHA256SUMS"));
        const hash = encodeHex(new Uint8Array(await crypto.subtle.digest("SHA-256", sums)));
        for (const r of after) {
          if (r.command.includes(".specnaut/hooks/")) {
            assert(r.command.includes(hash), `a Codex command pins a stale hash: ${r.command}`);
          }
        }
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
      await Deno.remove(home, { recursive: true });
    }
  });
}
