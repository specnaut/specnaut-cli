import { assertEquals } from "@std/assert";
import {
  bootstrapPrinciples,
  missingPrinciples,
} from "../../src/domain/constitution_principles.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { CONSTITUTION_PATH } from "../../src/domain/constitution_paths.ts";

/** Which default principles a project's constitution lacks (spec 038, A-L2). */

const BOOT = [
  "# Constitution",
  "",
  "## Ports and adapters",
  "",
  "Check: the core imports no framework.",
  "",
  "Override: name the core.",
  "",
  "## Small modules",
  "",
  "Check: one reason to change.",
  "Check: collaborators are passed in.",
  "",
  "## Not a principle",
  "",
  "Version: 1.0.0",
].join("\n");

Deno.test("the principles are the bootstrap's ## sections that carry a Check: line", () => {
  assertEquals(bootstrapPrinciples(BOOT), [
    { name: "Ports and adapters", checks: ["Check: the core imports no framework."] },
    {
      name: "Small modules",
      checks: ["Check: one reason to change.", "Check: collaborators are passed in."],
    },
  ]);
});

Deno.test("the shipped bootstrap yields its four principles", () => {
  const boot = CORE_BUNDLE.find((e) => e.suffix === CONSTITUTION_PATH)!.content;
  assertEquals(bootstrapPrinciples(boot).length, 4);
  assertEquals(missingPrinciples(boot, boot), []);
  assertEquals(missingPrinciples(boot, "# Ours\n").length, 4);
});

Deno.test("a heading at any level, ignoring case and whitespace, adopts the principle", () => {
  assertEquals(missingPrinciples(BOOT, "### PORTS   and\tadapters\n"), ["Small modules"]);
  assertEquals(missingPrinciples(BOOT, "# Small Modules\r\n"), ["Ports and adapters"]);
});

Deno.test("any one Check: line, reflowed or recased, adopts the principle", () => {
  const ours = "## Ours\n\ncheck: COLLABORATORS are\n   passed in.\n";
  assertEquals(missingPrinciples(BOOT, ours), ["Ports and adapters"]);
});

Deno.test("a heading named in prose, not as a heading, does not count", () => {
  assertEquals(missingPrinciples(BOOT, "We like these.\nSmall modules\n").length, 2);
});
