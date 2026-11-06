import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { AGENT_FOLDERS, agentFile } from "../../src/domain/agent_folders.ts";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/**
 * `specnaut upgrade` warns when the project's product-owner definition still
 * grants a shell or a write tool after the run: upgrade keeps a customised
 * file, so the old wide grant would otherwise stay with nothing said. Through
 * the real entry point: init, widen the file the way an older or customised
 * copy reads, upgrade, read what it printed.
 */

async function specnaut(args: string[], cwd: string, home: string) {
  const { code, stdout, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    env: { HOME: home, NO_COLOR: "1" }, // a throwaway HOME: no plugin installed
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { code, out: d.decode(stdout) + d.decode(stderr) };
}

/** Each harness's product-owner file, and how an older or customised copy widens it. */
const CASES = [
  {
    harness: "claude",
    path: agentFile(AGENT_FOLDERS.claude, "product-owner"),
    from: "tools: Read, Grep, Glob\n",
    to: "tools: Read, Write, Edit, Grep, Glob, Bash\n",
    grants: "Bash, Write, Edit",
  },
  {
    harness: "codex",
    path: agentFile(AGENT_FOLDERS.codex, "product-owner"),
    from: "shell_tool = false\n",
    to: "",
    grants: "Bash",
  },
  {
    harness: "opencode",
    path: agentFile(AGENT_FOLDERS.opencode, "product-owner"),
    from: '  "*": deny\n',
    to: "",
    grants: "Bash, Write, Edit",
  },
] as const;

const WARNING = "to the product owner, which now needs only";

for (const c of CASES) {
  Deno.test(`upgrade [${c.harness}]: a kept wide product-owner grant is named, with the fix`, async () => {
    const dir = await Deno.makeTempDir({ prefix: `specnaut-po-grant-${c.harness}-` });
    const home = await Deno.makeTempDir({ prefix: "specnaut-home-" });
    try {
      const init = await specnaut(
        ["init", "--here", "--no-git", "--ai", c.harness, "--backlog", "local"],
        dir,
        home,
      );
      assertEquals(init.code, 0, init.out);
      const fresh = await specnaut(["upgrade"], dir, home);
      assertEquals(fresh.code, 0, fresh.out);
      assert(!fresh.out.includes(WARNING), fresh.out);

      const file = join(dir, c.path);
      const shipped = await Deno.readTextFile(file);
      assertStringIncludes(shipped, c.from);
      await Deno.writeTextFile(file, shipped.replace(c.from, c.to));
      const kept = await specnaut(["upgrade"], dir, home);
      assertEquals(kept.code, 0, kept.out);
      assertStringIncludes(kept.out, `${c.path} still grants ${c.grants} ${WARNING}`);
      assertStringIncludes(kept.out, "specnaut upgrade --force");

      const forced = await specnaut(["upgrade", "--force"], dir, home);
      assertEquals(forced.code, 0, forced.out);
      assert(!forced.out.includes(WARNING), forced.out);
      assertEquals(await Deno.readTextFile(file), shipped);
    } finally {
      await Deno.remove(dir, { recursive: true });
      await Deno.remove(home, { recursive: true });
    }
  });
}

Deno.test("upgrade: an up-to-date project still hears of another harness's wide product owner", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-po-grant-current-" });
  const home = await Deno.makeTempDir({ prefix: "specnaut-home-" });
  try {
    const init = await specnaut(["init", "--here", "--no-git", "--ai", "claude"], dir, home);
    assertEquals(init.code, 0, init.out);
    const stray = agentFile(AGENT_FOLDERS.opencode, "product-owner");
    await Deno.mkdir(join(dir, stray, ".."), { recursive: true });
    await Deno.writeTextFile(
      join(dir, stray),
      "---\nmode: subagent\npermission:\n  read: allow\n---\n",
    );
    const out = await specnaut(["upgrade"], dir, home);
    assertEquals(out.code, 0, out.out);
    assertStringIncludes(out.out, "already up to date");
    assertStringIncludes(out.out, `${stray} still grants Bash, Write, Edit ${WARNING}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
});
