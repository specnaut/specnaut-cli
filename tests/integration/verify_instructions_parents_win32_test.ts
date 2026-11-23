import { assertEquals, assertNotEquals } from "@std/assert";
import { SHORT_NAME_REASON, WIN32_ALIAS_REASON } from "../../src/domain/win32_path.ts";
import { fixture, verify } from "./verify_scripts_fixture.ts";
import { base, commitIndexed, lines } from "./verify_instructions_fixture.ts";

/**
 * A project in a subfolder: the files above it are listed as Win32 opens their names. A name that
 * ends in a dot or a space, or holds a stream suffix, and a name shaped like an 8.3 short name are
 * judged in every folder up to the repository's top, and enter the digest.
 */

const SHORT = ["AGENTS~1.MD", "CLAUDE~1.MD", "GITATT~1", "LFSCON~1"];
const ALIASES = ["AGENTS.md.", "CLAUDE.md ", ".gitattributes::$DATA", ".lfsconfig:x"];

const expected = (up: string) =>
  [
    ...SHORT.map((n) => `${up}${n} ${SHORT_NAME_REASON}`),
    ...ALIASES.map((n) => `${up}${n} ${WIN32_ALIAS_REASON}`),
  ].sort().map((l) => `VERDICT instructions untrusted ${l}`);

/** Where the files sit, from the repository's top, and how a project at `apps/web` names them. */
const FOLDERS = [["the top folder", "", "../../"], ["a folder between", "apps/", "../"]];

for (const [where, dir, up] of FOLDERS) {
  Deno.test(`short names and Win32 aliases of the parent names in ${where} are named`, async () => {
    const { root, project } = await fixture({ files: base(), prefix: "apps/web" });
    await commitIndexed(root, [...SHORT, ...ALIASES].map((n) => `${dir}${n}`));
    assertEquals(await lines(project), expected(up));
  });
}

Deno.test("the digest covers a short-name file above the project", async () => {
  const { root, project } = await fixture({ files: base(), prefix: "app" });
  await commitIndexed(root, ["GITATT~1"]);
  const approved = (await verify(project)).field("INSTRUCTIONS_DIGEST");
  await commitIndexed(root, ["GITATT~1"], "* filter=run\n");
  assertNotEquals((await verify(project)).field("INSTRUCTIONS_DIGEST"), approved);
});
