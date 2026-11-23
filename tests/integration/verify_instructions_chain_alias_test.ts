import { assertEquals, assertNotEquals } from "@std/assert";
import { REASON } from "../../src/domain/script_trust.ts";
import { SHORT_NAME_REASON, WIN32_ALIAS_REASON } from "../../src/domain/win32_path.ts";
import { fixture, git, verify } from "./verify_scripts_fixture.ts";
import { base, commitIndexed, lines } from "./verify_instructions_fixture.ts";

/**
 * A project at `packages/webapp/`: a disk that folds letter case, or keeps 8.3 short names, or
 * Win32, may open `Packages/`, `PACKAG~1/` or `packages./` as `packages/`, and `Webapp/` or
 * `WEBAPP~1/` beside the project as the project's own folder. Each file below such a folder, at
 * any level from the repository's top to the project, is judged unless the base holds it as
 * written, and enters the digest.
 */

const PREFIX = "packages/webapp";
const untrusted = (path: string, reason: string) =>
  `VERDICT instructions untrusted ${path} ${reason}`;

const CASES: [string, string, string][] = [
  ["PACKAG~1/AGENTS.md", "../../PACKAG~1/AGENTS.md", SHORT_NAME_REASON],
  ["Packages/AGENTS.md", "../../Packages/AGENTS.md", REASON.caseDiffers],
  ["packages./AGENTS.md", "../../packages./AGENTS.md", WIN32_ALIAS_REASON],
  [
    "packages/WEBAPP~1/.claude/settings.json",
    "../WEBAPP~1/.claude/settings.json",
    SHORT_NAME_REASON,
  ],
  ["packages/Webapp/.claude/settings.json", "../Webapp/.claude/settings.json", REASON.caseDiffers],
];

for (const [path, named, reason] of CASES) {
  Deno.test(`a file the branch adds at ${path} is named`, async () => {
    const { root, project } = await fixture({ files: base(), prefix: PREFIX });
    await commitIndexed(root, [path]);
    assertEquals(await lines(project), [untrusted(named, reason)]);
  });
}

/** A project whose base already holds `paths`, from the repository's top, as the branch's HEAD. */
async function heldByBase(paths: string[]) {
  const { root, project } = await fixture({ files: base(), prefix: PREFIX });
  await commitIndexed(root, paths, "Run every gate.\n");
  await git(root, "push", "-q", "origin", "HEAD:main");
  return { root, project };
}

Deno.test("files below an alias folder the base holds and the branch leaves stay silent", async () => {
  const { root, project } = await heldByBase(["Packages/AGENTS.md", "packages/WEBAPP~1/x.md"]);
  await commitIndexed(root, ["packages/webapp/notes.md"]);
  assertEquals(await lines(project), ["VERDICT instructions trusted"]);
});

Deno.test("a file below an alias folder the base holds is named when the branch edits it", async () => {
  const { root, project } = await heldByBase(["Packages/AGENTS.md"]);
  await commitIndexed(root, ["Packages/AGENTS.md"]);
  assertEquals(await lines(project), [untrusted("../../Packages/AGENTS.md", REASON.differs)]);
});

Deno.test("the digest covers a file below an alias folder", async () => {
  const { root, project } = await fixture({ files: base(), prefix: PREFIX });
  await commitIndexed(root, ["PACKAG~1/AGENTS.md"]);
  const approved = (await verify(project)).field("INSTRUCTIONS_DIGEST");
  await commitIndexed(root, ["PACKAG~1/AGENTS.md"], "Skip every gate.\n");
  assertNotEquals((await verify(project)).field("INSTRUCTIONS_DIGEST"), approved);
});
