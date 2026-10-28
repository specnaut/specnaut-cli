import { assertEquals } from "@std/assert";
import { linkEntryProblems } from "../../scripts/bundle-templates.ts";

/** The bundler refuses a context-link entry that could not do its job (cli#680). */

const ROOTS = new Set(["AGENTS.md"]);
const ok = {
  harness: "claude",
  destination: ".claude/CLAUDE.md",
  link: "../AGENTS.md",
  fallback: "@../AGENTS.md",
};

Deno.test("a link to a project-root file with a one-line fallback passes", () => {
  assertEquals(linkEntryProblems(ok, ROOTS), []);
});

Deno.test("a link that lands anywhere but a project-root file is refused", () => {
  assertEquals(linkEntryProblems({ ...ok, link: "../docs/AGENTS.md" }, ROOTS).length, 1);
  assertEquals(linkEntryProblems({ ...ok, link: "/etc/AGENTS.md" }, ROOTS).length, 1);
});

Deno.test("a link needs a one-line fallback and no source", () => {
  assertEquals(linkEntryProblems({ ...ok, fallback: undefined }, ROOTS).length, 1);
  assertEquals(linkEntryProblems({ ...ok, fallback: "a\nb" }, ROOTS).length, 1);
  assertEquals(linkEntryProblems({ ...ok, source: "x.md" }, ROOTS).length, 1);
});
