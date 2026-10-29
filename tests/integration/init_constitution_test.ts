import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs/exists";
import { join } from "@std/path";
import { runSpecnaut } from "../helpers/run_specnaut.ts";
import {
  CONSTITUTION_PATH,
  LEGACY_CONSTITUTION_PATH,
} from "../../src/domain/constitution_paths.ts";

/**
 * `init` bootstraps the team's constitution once, at `docs/constitution.md`,
 * and never again — not even under `--force` (spec 038, FR-001, FR-004).
 */

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-constitution-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

for (const ai of ["claude", "codex"]) {
  Deno.test(`init (${ai}) writes docs/constitution.md and no legacy file`, async () => {
    await withTempDir(async (dir) => {
      const { code, stderr } = await runSpecnaut(
        ["init", "--here", "--no-git", "--ai", ai, "--backlog", "local"],
        { cwd: dir },
      );
      assertEquals(code, 0, stderr);
      const text = await Deno.readTextFile(join(dir, CONSTITUTION_PATH));
      assert(/^Check:/m.test(text), "the bootstrap carries its checks");
      assertEquals(await exists(join(dir, LEGACY_CONSTITUTION_PATH)), false);
    });
  });

  Deno.test(`init --force (${ai}) keeps an existing docs/constitution.md byte-identical`, async () => {
    await withTempDir(async (dir) => {
      const first = await runSpecnaut(
        ["init", "--here", "--no-git", "--ai", ai, "--backlog", "local"],
        { cwd: dir },
      );
      assertEquals(first.code, 0, first.stderr);
      const ours = "# Acme constitution\r\n\r\n## Our one rule\r\n\r\nCheck: it holds.";
      await Deno.writeTextFile(join(dir, CONSTITUTION_PATH), ours);
      const forced = await runSpecnaut(
        ["init", "--here", "--force", "--no-git", "--ai", ai, "--backlog", "local"],
        { cwd: dir },
      );
      assertEquals(forced.code, 0, forced.stderr);
      assertEquals(await Deno.readTextFile(join(dir, CONSTITUTION_PATH)), ours);
      assertEquals(await exists(join(dir, `${CONSTITUTION_PATH}.specnaut.bak`)), false);
    });
  });
}
