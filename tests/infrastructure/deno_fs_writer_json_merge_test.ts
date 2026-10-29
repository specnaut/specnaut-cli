import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DenoFsWriter } from "../../src/infrastructure/deno_fs_writer.ts";
import type { Bundle } from "../../src/domain/template.ts";
import { codexHookCommand } from "../../src/domain/hook_command.ts";

/**
 * The writer dispatches a `mergeJson` file to its flavor and reports which
 * merged files it changed (plan § 5: "Whether a merged JSON file changed" is the
 * flavor's return value, reported by the writer — never re-diffed by a caller).
 * The Codex trust note keys on that report: a hook file that did not change
 * must not ask the user to re-trust anything.
 */

const hooks = (command: string) => ({
  hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command }] }] },
});

const PLUGINS = { enabledPlugins: { "acme@acme-marketplace": true } };
const guard = (hash: string) =>
  codexHookCommand({ script: "guard-merge.sh", args: "codex", onChanged: 2 }, hash.repeat(64));

function bundle(flavor: "claude-settings" | "codex-hooks", dest: string): Bundle {
  const content = JSON.stringify({ ...hooks(guard("b")), ...PLUGINS });
  return { [dest]: { content, executable: false, mergeJson: flavor } };
}

async function inTemp(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-json-merge-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("writeBundle: a merged JSON file is reported when it changed, and not on the re-run", async () => {
  await inTemp(async (dir) => {
    const writer = new DenoFsWriter();
    const b = bundle("claude-settings", ".claude/settings.json");
    const first = await writer.writeBundle(b, dir, { overwrite: true });
    assertEquals(first.mergedChanged, [".claude/settings.json"]);
    const second = await writer.writeBundle(b, dir, { overwrite: true });
    assertEquals(second.mergedChanged, undefined);
  });
});

Deno.test("writeBundle: codex-hooks splices with its own flavor and says nothing about plugins", async () => {
  await inTemp(async (dir) => {
    const dest = ".codex/hooks.json";
    await Deno.mkdir(join(dir, ".codex"));
    const user = hooks(guard("0"));
    await Deno.writeTextFile(join(dir, dest), JSON.stringify({ ...user, note: "mine" }));

    const report = await new DenoFsWriter().writeBundle(bundle("codex-hooks", dest), dir, {
      overwrite: true,
    });

    const written = JSON.parse(await Deno.readTextFile(join(dir, dest)));
    assertEquals(written, { ...hooks(guard("b")), note: "mine" });
    assertEquals(report.mergedChanged, [dest]);
    assertEquals(report.notes, undefined);
  });
});

Deno.test("writeBundle: claude-settings still reports what it did to the plugin declarations", async () => {
  await inTemp(async (dir) => {
    const dest = ".claude/settings.json";
    await Deno.mkdir(join(dir, ".claude"));
    await Deno.writeTextFile(join(dir, dest), JSON.stringify({ theme: "dark" }));
    const report = await new DenoFsWriter().writeBundle(bundle("claude-settings", dest), dir, {
      overwrite: true,
    });
    assertEquals(report.notes?.length, 1);
  });
});
