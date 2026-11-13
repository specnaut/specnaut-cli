import { assertEquals } from "@std/assert";
import { LINK_REASON } from "../../src/domain/checkout_link.ts";
import { headLinkReasons, linkEnd } from "../../src/domain/head_link.ts";
import type { BaseEntry } from "../../src/domain/script_trust.ts";

/**
 * A link HEAD commits among the instruction files is judged by where it leads within HEAD's own
 * tree, read as text: the same on a checkout that writes links as files as on one that does not.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const blob = (path: string): BaseEntry => ({ kind: "blob", path, bytes: enc("rules\n") });
const link = (path: string, target: string): BaseEntry => ({ kind: "link", path, target });

Deno.test("a link's end is its target read from the link's folder, within the project", () => {
  assertEquals(linkEnd(".claude/CLAUDE.md", "../AGENTS.md"), "AGENTS.md");
  assertEquals(linkEnd("CLAUDE.md", "./AGENTS.md"), "AGENTS.md");
  assertEquals(
    linkEnd(".specnaut/addenda/task/a.md", "../shared/a.md"),
    ".specnaut/addenda/shared/a.md",
  );
  assertEquals(linkEnd("CLAUDE.md", "../outside.md"), null);
  assertEquals(linkEnd("CLAUDE.md", "/etc/rules.md"), null);
  assertEquals(linkEnd("CLAUDE.md", ""), null);
});

Deno.test("a link to an instruction file HEAD holds, or into the addenda, is no reason", () => {
  const entries = [blob("AGENTS.md"), link("CLAUDE.md", "AGENTS.md")];
  assertEquals(headLinkReasons(entries), []);
  const into = [link(".specnaut/addenda/task/a.md", "../shared/a.md")];
  assertEquals(headLinkReasons(into), []);
});

Deno.test("a link out of the files this class judges is named, whatever the checkout writes", () => {
  const out = [link("CLAUDE.md", "notes/rules.md"), link("AGENTS.md", "../x.md")];
  assertEquals(headLinkReasons(out), [
    { path: "CLAUDE.md", reason: LINK_REASON.linkLeaves },
    { path: "AGENTS.md", reason: LINK_REASON.linkLeaves },
  ]);
});

Deno.test("a link to an instruction path HEAD does not hold leads nowhere", () => {
  assertEquals(headLinkReasons([link("CLAUDE.md", "docs/constitution.md")]), [
    { path: "CLAUDE.md", reason: `${LINK_REASON.linkUnresolved}: not at HEAD` },
  ]);
});

Deno.test("a link target with a backslash or a drive is named by its form", () => {
  for (const target of ["..\\AGENTS.md", "C:/AGENTS.md"]) {
    assertEquals(headLinkReasons([blob("AGENTS.md"), link("CLAUDE.md", target)]), [
      { path: "CLAUDE.md", reason: LINK_REASON.linkForm },
    ]);
  }
});
