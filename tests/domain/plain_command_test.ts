import { assertEquals } from "@std/assert";
import { plainWords } from "../../src/domain/plain_command.ts";

Deno.test("a line that is one program and its words reads as the words the program gets", () => {
  const cases: [string, string[]][] = [
    ["specnaut verify-scripts", ["specnaut", "verify-scripts"]],
    ["  mktemp\t-d  ", ["mktemp", "-d"]],
    [`specnaut sandbox exec a --log=/tmp/x/1.log -- sh -c 'npm test && npm run lint'`, [
      "specnaut",
      "sandbox",
      "exec",
      "a",
      "--log=/tmp/x/1.log",
      "--",
      "sh",
      "-c",
      "npm test && npm run lint",
    ]],
    [`bash "a b"c'd e' ""`, ["bash", "a bcd e", ""]],
    ["a 'it''s' \"x; y | z\"", ["a", "its", "x; y | z"]],
  ];
  for (const [line, words] of cases) assertEquals(plainWords(line), words, line);
});

Deno.test("a line the shell would read as more than one program and its words is not plain", () => {
  const refused = [
    "",
    "   ",
    "a; git push",
    "a && git push",
    "a || git push",
    "a | sh",
    "a & git push",
    "a\ngit push",
    "a\rgit push",
    "a $(git push)",
    "a `git push`",
    'a "$(git push)"',
    'a "`git push`"',
    'a "x\\"; git push; \\""',
    "a $HOME",
    "a ${HOME}",
    "a > /tmp/x",
    "a < /tmp/x",
    "a 2>&1",
    "a *",
    "a ?",
    "a [ab]",
    "a {b,c}",
    "a ~/x",
    "a # comment",
    "(a)",
    "a 'unclosed",
    'a "unclosed',
    "a \\; git push",
    "a 'x\ngit push'",
    'a "x\ngit push"',
    'a "!x"',
    "a '\x1b[2J'",
    "a \x7f",
  ];
  for (const line of refused) assertEquals(plainWords(line), null, JSON.stringify(line));
});

Deno.test("a long line of words that ends in a refused character fails fast, not by backtracking", () => {
  const line = `a ${"b".repeat(200_000)}'x ${"c".repeat(200_000)};`;
  const started = performance.now();
  assertEquals(plainWords(line), null);
  assertEquals(performance.now() - started < 1000, true, "under a second");
});
