import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { stripAnsiCode } from "@std/fmt/colors";
import { join } from "@std/path";
import { runSpecnaut } from "../helpers/run_specnaut.ts";
import { CAN_LINK } from "../helpers/link_text.ts";

/**
 * What `init` and `upgrade` PRINT about a context link (cli#680), through the
 * real handlers. `write_report_test.ts` pins the sentences; this pins that the
 * handlers say them — a line the use case reports and no handler prints is a
 * fallback the user is never told about.
 *
 * The form is the system's: where links are refused the run writes the
 * fallback, so the expected line follows the same probe the link tests use.
 */

const DEST = ".claude/CLAUDE.md";
const FORM_LINE = CAN_LINK
  ? `✓ ${DEST} → ../AGENTS.md (symlink)`
  : `⚠ ${DEST} written as a one-line pointer to ../AGENTS.md`;

async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-link-report-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function run(args: string[], cwd: string): Promise<string> {
  const r = await runSpecnaut(args, { cwd });
  assertEquals(r.code, 0, `${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
  return stripAnsiCode(r.stdout);
}

Deno.test("init names the form the context link took", async () => {
  await withProject(async (dir) => {
    const out = await run(
      ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"],
      dir,
    );
    assertStringIncludes(out, FORM_LINE);
  });
});

Deno.test("upgrade warns it replaced a customized context file with a link, and names the form", async () => {
  await withProject(async (dir) => {
    await run(["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"], dir);
    // Removed first: writing through the link would edit AGENTS.md instead.
    await Deno.remove(join(dir, DEST));
    await Deno.writeTextFile(join(dir, DEST), "# my own rules\n");
    const out = await run(["upgrade"], dir);
    assertStringIncludes(out, "replaced with a link to AGENTS.md (yours backed up — see below)");
    assertStringIncludes(
      out,
      `↪ ${DEST} (was your own file — move what you need into AGENTS.md)`,
    );
    assertStringIncludes(out, `↳ backed up ${DEST} → ${DEST}.specnaut.bak`);
    assertStringIncludes(out, FORM_LINE);
    // The warning is about what the run did: the next one has nothing to say.
    const again = await run(["upgrade"], dir);
    assert(!again.includes("replaced with a link"), again);
  });
});
