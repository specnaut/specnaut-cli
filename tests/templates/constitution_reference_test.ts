import { assertEquals } from "@std/assert";
import {
  claimsExemption,
  exemptionReason,
  firstStep,
  importTokens,
  LEADING_LINES,
} from "./constitution_reference.ts";

/**
 * The helpers the constitution guard is built on (spec 039, specnaut-cli#706).
 *
 * The guard is only as strict as these: a helper that reads less than the
 * harness reads lets an entry point pass that the harness would treat
 * differently. Each case below is a shape a template can take.
 */

const fm = (yaml: string, body = "# Title\n\nFirst step.\n") => `---\n${yaml}\n---\n${body}`;

Deno.test("importTokens: a token needs line start or whitespace before it", () => {
  assertEquals(importTokens("@docs/a.md\nsee @b.md, then mail me@example.com"), [
    "@docs/a.md",
    "@b.md,",
  ]);
  assertEquals(importTokens("@my\\ file.md next"), ["@my\\ file.md"]);
  assertEquals(importTokens("@a.md\r\n@b.md\r\n"), ["@a.md", "@b.md"]);
});

Deno.test("importTokens: code spans, fenced blocks and HTML comments hide a token", () => {
  assertEquals(importTokens("use `@a.md` here"), []);
  assertEquals(importTokens("a `span that\n@wraps.md` inside its paragraph"), []);
  assertEquals(importTokens("```md\n@a.md\n```\n~~~\n@b.md\n~~~\n"), []);
  assertEquals(importTokens("<!-- @a.md\n@b.md -->"), []);
});

Deno.test("importTokens: a code span never crosses a blank line", () => {
  assertEquals(importTokens("an open `tick\n\n@a.md and a close `"), ["@a.md"]);
});

Deno.test("importTokens: a `<!--` inside a code span or block opens no comment", () => {
  // Regression (cli#706): comments were stripped before code, so a `<!--`
  // written as code swallowed everything up to the next `-->`, imports included.
  assertEquals(
    importTokens("Type `<!--` to open one.\n@docs/x.md\nThen `-->` closes it.\n"),
    ["@docs/x.md"],
  );
  assertEquals(importTokens("```\n<!--\n```\n@docs/x.md\n-->\n"), ["@docs/x.md"]);
});

Deno.test("importTokens: a backtick inside an HTML comment opens no code span", () => {
  assertEquals(importTokens("<!-- a ` tick -->\n@docs/x.md and a ` later"), ["@docs/x.md"]);
});

Deno.test("exemptionReason: a non-empty string is a reason, whatever its YAML shape", () => {
  assertEquals(exemptionReason(fm("constitution-exempt: output contract")), "output contract");
  assertEquals(exemptionReason(fm(`"constitution-exempt": "output contract"`)), "output contract");
  assertEquals(exemptionReason(fm(`'constitution-exempt': output contract`)), "output contract");
  assertEquals(
    exemptionReason(fm("constitution-exempt: >-\n  read\n  mid-phase")),
    "read mid-phase",
  );
  assertEquals(
    exemptionReason("---\r\nconstitution-exempt: crlf reason\r\n---\r\nbody\r\n"),
    "crlf reason",
  );
});

Deno.test("exemptionReason: empty, boolean-looking and non-string values are no reason", () => {
  for (
    const v of ["", `""`, "true", "no", "On", "~", "null", `"yes"`, "' false '", "42", "[a]"]
  ) {
    assertEquals(exemptionReason(fm(`constitution-exempt: ${v}`)), null, v);
  }
  assertEquals(exemptionReason(fm("name: x")), null, "key absent");
  assertEquals(exemptionReason("constitution-exempt: not frontmatter\n"), null, "no frontmatter");
});

Deno.test("claimsExemption: follows the YAML parse, not the text of the line", () => {
  // Fail-open defect (cli#706): a quoted key was a reason to `exemptionReason`
  // and invisible to a line regex, so a router that may not opt out could.
  assertEquals(claimsExemption(fm(`"constitution-exempt": "a reason"`)), true, "double-quoted");
  assertEquals(claimsExemption(fm(`'constitution-exempt': a reason`)), true, "single-quoted");
  assertEquals(claimsExemption(fm("constitution-exempt   : a reason")), true, "spaced colon");
  assertEquals(claimsExemption(fm("constitution-exempt:")), true, "empty value");
  assertEquals(claimsExemption(fm("constitution-exempt: false")), true, "boolean value");
  assertEquals(claimsExemption(fm("x-constitution-exempt: a reason")), false, "another key");
  assertEquals(
    claimsExemption(fm("description: |\n  constitution-exempt: inside a value")),
    false,
    "the key's text inside another key's value",
  );
  assertEquals(claimsExemption("# T\n\nconstitution-exempt: in the body\n"), false, "body");
});

Deno.test("claimsExemption holds wherever exemptionReason finds a reason", () => {
  const shapes = [
    "constitution-exempt: r",
    `"constitution-exempt": r`,
    `'constitution-exempt': "r"`,
    "? constitution-exempt\n: r",
    "constitution-exempt: |\n  r",
  ];
  for (const yaml of shapes) {
    assertEquals(exemptionReason(fm(yaml)), "r", yaml);
    assertEquals(claimsExemption(fm(yaml)), true, yaml);
  }
});

Deno.test("firstStep skips exactly the leading lines it is told to, never a guessed title", () => {
  const router = fm("name: task", "# Task router\n\nRead it.\n\n## Next\n");
  assertEquals(firstStep(router, LEADING_LINES.router), "Read it.");
  // A verb document's first non-blank line is its first step (FR-005): a title
  // there is the line the reference should have been, not a line to skip.
  assertEquals(firstStep("# /task audit\n\nRead it.\n", LEADING_LINES.verbDoc), "# /task audit");
  assertEquals(firstStep("Read it.\n# A title, later\n", LEADING_LINES.router), "# A title, later");
});

Deno.test("firstStep: frontmatter is not a step, blank lines are not counted", () => {
  assertEquals(firstStep(fm("name: x", "\n\n  Read it.  \n"), LEADING_LINES.agent), "Read it.");
  assertEquals(firstStep("---\r\nname: x\r\n---\r\n\r\nRead it.\r\n", 0), "Read it.");
  assertEquals(firstStep(fm("name: x", "\n"), 0), null, "an empty body has no first step");
  assertEquals(firstStep("# Only a title\n", LEADING_LINES.router), null);
});
