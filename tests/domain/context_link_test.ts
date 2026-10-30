import { assertEquals } from "@std/assert";
import {
  classifyLinkDisk,
  type DiskEntry,
  type LinkEvidence,
  linkIdentity,
  linkOwnership,
  linkTargetPath,
} from "../../src/domain/context_link.ts";
import { lockShaInput } from "../../src/domain/template.ts";

const DEST = ".claude/CLAUDE.md";
const LINK = { symlinkTo: "../AGENTS.md", content: "@../AGENTS.md\n" };
const agentsFile: DiskEntry = { kind: "file", content: "# AGENTS\n" };

const classify = (ev: Partial<LinkEvidence>) =>
  classifyLinkDisk(DEST, LINK, { disk: null, targetEntry: agentsFile, ...ev });
const file = (content: string): DiskEntry => ({ kind: "file", content });
const link = (target: string, resolved: string | null = "AGENTS.md"): DiskEntry => ({
  kind: "symlink",
  target,
  resolved,
});
/** A link as the reader reports it on Windows, where `\` separates segments. */
const winLink = (target: string): DiskEntry => ({
  kind: "symlink",
  target,
  resolved: "AGENTS.md",
  windows: true,
});

Deno.test("classifyLinkDisk: nothing on disk is absent", () => {
  assertEquals(classify({}), "absent");
});

Deno.test("classifyLinkDisk: our link is recognised by its exact text", () => {
  assertEquals(classify({ disk: link("../AGENTS.md") }), "ours-link");
  // Windows writes the target with `\`; a link read there is still ours.
  assertEquals(classify({ disk: winLink("..\\AGENTS.md") }), "ours-link");
  assertEquals(classify({ disk: winLink("../AGENTS.md") }), "ours-link");
});

Deno.test("classifyLinkDisk: any other text is foreign, even one that normalises to ours", () => {
  // Elsewhere `\` is a literal character: `..\AGENTS.md` names a file of that name.
  assertEquals(classify({ disk: link("..\\AGENTS.md") }), "foreign-link");
  // On POSIX `a\b` is ONE segment, so this climbs out of the project; a
  // lexical normalisation that read `\` as a separator classed it as ours.
  assertEquals(classify({ disk: link("a\\b/../../../AGENTS.md", null) }), "foreign-link");
  assertEquals(classify({ disk: winLink("a\\b/../../../AGENTS.md") }), "foreign-link");
  assertEquals(classify({ disk: link("./../AGENTS.md") }), "foreign-link");
});

Deno.test("classifyLinkDisk: a link elsewhere is foreign", () => {
  assertEquals(classify({ disk: link("../docs/AGENTS.md", "docs/AGENTS.md") }), "foreign-link");
});

Deno.test("classifyLinkDisk: the fallback file is ours, trailing newlines tolerated", () => {
  assertEquals(classify({ disk: file("@../AGENTS.md\n") }), "ours-fallback");
  assertEquals(classify({ disk: file("@../AGENTS.md") }), "ours-fallback");
  assertEquals(classify({ disk: file("@../AGENTS.md\r\n") }), "ours-fallback");
});

Deno.test("classifyLinkDisk: a link checked out as text (core.symlinks=false) is materialised", () => {
  assertEquals(classify({ disk: file("../AGENTS.md") }), "materialised");
  assertEquals(classify({ disk: file("../AGENTS.md\n") }), "materialised");
  // Git stores a link's text with `/` on every system, so the checked-out text
  // is exactly ours or it is not ours.
  assertEquals(classify({ disk: file("..\\AGENTS.md") }), "customized");
});

Deno.test("classifyLinkDisk: a file the lock vouches for is generated, any other is customized", () => {
  assertEquals(classify({ disk: file("# old\n"), diskSha: "s1", lockSha: "s1" }), "generated");
  assertEquals(classify({ disk: file("# mine\n"), diskSha: "s2", lockSha: "s1" }), "customized");
  // No lock entry is no vouching: the file is the user's.
  assertEquals(classify({ disk: file("# mine\n"), diskSha: "s2" }), "customized");
});

Deno.test("classifyLinkDisk: AGENTS.md linking back to the destination wins over everything", () => {
  // The project consolidated the other way round: its content lives in
  // `.claude/CLAUDE.md`. Every other answer leads to a write there.
  const inverted = link("../.claude/CLAUDE.md", DEST);
  assertEquals(classify({ targetEntry: inverted, disk: file("# all of it\n") }), "inverted");
  assertEquals(
    classify({ targetEntry: inverted, disk: file("# all"), diskSha: "a", lockSha: "a" }),
    "inverted",
  );
  // A target link that lands elsewhere is not an inversion.
  assertEquals(classify({ targetEntry: link("docs/A.md", "docs/A.md"), disk: null }), "absent");
  // Nor is one that cannot be followed.
  assertEquals(classify({ targetEntry: link("x", null), disk: link("../AGENTS.md") }), "ours-link");
});

Deno.test("linkTargetPath resolves from the destination's own directory", () => {
  assertEquals(linkTargetPath(".claude/CLAUDE.md", "../AGENTS.md"), "AGENTS.md");
  assertEquals(linkTargetPath(".codex/AGENTS.md", "../AGENTS.md"), "AGENTS.md");
});

Deno.test("the lock hashes a context link's identity, never its fallback text", () => {
  // Both forms record one sha, so a committed lock does not flip between a
  // contributor whose system makes links and one whose does not.
  assertEquals(
    lockShaInput({ content: "@../AGENTS.md\n", executable: false, symlinkTo: "../AGENTS.md" }),
    linkIdentity("../AGENTS.md"),
  );
});

Deno.test("linkOwnership: one rule for diff and upgrade — every state has an owner", () => {
  const owners = Object.fromEntries(
    ([
      "absent",
      "ours-link",
      "ours-fallback",
      "materialised",
      "generated",
      "customized",
      "foreign-link",
      "inverted",
    ] as const)
      .map((s) => [s, linkOwnership(s)]),
  );
  assertEquals(owners, {
    "absent": "rewritable",
    "ours-link": "ours",
    "ours-fallback": "ours",
    "materialised": "rewritable",
    "generated": "rewritable",
    "customized": "theirs",
    "foreign-link": "theirs",
    "inverted": "theirs",
  });
});
