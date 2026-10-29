import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runSpecnaut } from "../helpers/run_specnaut.ts";
import { CONSTITUTION_PATH } from "../../src/domain/constitution_paths.ts";

/**
 * Upgrade names the default principles a team's constitution lacks, once per
 * run, and never touches the file (spec 038, US3, SC-003).
 */

const OURS = "# Acme rules\n\n## Domain Isolation\n\nCheck: our own check.\n";

for (const ai of ["claude", "codex"]) {
  Deno.test(`${ai}: upgrade lists the missing default principles once, file untouched`, async () => {
    const dir = await Deno.makeTempDir({ prefix: "specnaut-notice-" });
    try {
      const init = await runSpecnaut(
        ["init", "--here", "--no-git", "--ai", ai, "--backlog", "local"],
        { cwd: dir },
      );
      assertEquals(init.code, 0, init.stderr);
      const quiet = await runSpecnaut(["upgrade"], { cwd: dir });
      assertEquals(
        quiet.stdout.includes("default principles"),
        false,
        "the bootstrap lacks nothing",
      );

      await Deno.writeTextFile(join(dir, CONSTITUTION_PATH), OURS);
      for (const flags of [[], ["--force"], ["--dry-run"]]) {
        const r = await runSpecnaut(["upgrade", ...flags], { cwd: dir });
        assertEquals(r.code, 0, r.stderr);
        const lines = r.stdout.split("\n").filter((l) => l.includes("default principles"));
        assertEquals(lines.length, 1, `${flags}: ${r.stdout}`);
        for (const name of ["Dependencies point inward", "Bounded contexts", "SOLID"]) {
          assertEquals(lines[0].includes(name), true, name);
        }
        assertEquals(lines[0].includes("Domain isolation"), false, "a heading match adopts it");
        assertEquals(await Deno.readTextFile(join(dir, CONSTITUTION_PATH)), OURS);
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
}
