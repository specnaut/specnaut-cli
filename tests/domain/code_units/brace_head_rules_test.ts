import { assertEquals } from "@std/assert";
import { shapes } from "./_shapes.ts";

/** Each word below opens no function, on the shape it is written in or on the line it ends. */
function assertNoHead(path: string, words: readonly string[]): void {
  for (const word of words) {
    assertEquals(shapes(path, `${word} (a) {\n}\n`), [], `${path}: ${word} (a) {`);
    assertEquals(shapes(path, `run(x)\n${word} {\n}\n`), [], `${path}: run(x) then ${word} {`);
  }
}

const CONTROL = [
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "catch",
  "try",
  "return",
  "throw",
  "new",
];

Deno.test("no control word of a family is ever a function", () => {
  assertNoHead("a.c", CONTROL);
  assertNoHead("a.cpp", CONTROL);
  assertNoHead("A.java", [...CONTROL, "synchronized"]);
  assertNoHead("a.ts", [...CONTROL, "export", "with"]);
  assertNoHead("a.js", [...CONTROL, "export", "with"]);
  assertNoHead("a.cs", [...CONTROL, "foreach", "using", "lock", "fixed", "checked", "unchecked"]);
});

Deno.test("a semicolon ends a head: what follows is a block", () => {
  assertEquals(shapes("a.js", "run(a);\n{\n  b();\n}\n"), []);
  assertEquals(shapes("a.ts", "declare function a(b: string);\n{\n  c();\n}\n"), []);
});

Deno.test("a paren with no word before it names nothing", () => {
  assertEquals(shapes("a.js", "(a) {\n}\n"), []);
});

Deno.test("an operator before a brace means an object, not a body", () => {
  assertEquals(shapes("a.js", "run(x) ? { b: 1 } : { c: 2 };\n"), []);
  assertEquals(shapes("a.js", "run(x), { d: 3 };\n"), []);
});

Deno.test("an arrow's body comes right after it; an array of objects is not one", () => {
  assertEquals(shapes("a.js", "const a = () => [{ b: 1 }];\n"), []);
  assertEquals(shapes("a.js", 'const a = () => "x" + { b: 1 };\n'), []);
});

Deno.test("a typed name keeps the name, not the type", () => {
  assertEquals(shapes("a.ts", "const onClose: Handler = () => {\n};\n"), [
    "function onClose @1 x2",
  ]);
});

Deno.test("a subscript has no name to give", () => {
  assertEquals(shapes("a.js", "rows[0] = () => {\n};\n"), ["function ? @1 x2"]);
});

Deno.test("an assignment's name survives a line end while its value has yet to start", () => {
  const multilineParams = "const named = (\n  a,\n) => {\n};\n";
  assertEquals(shapes("a.js", multilineParams), ["function named @1 x4"]);
  const afterColon = "const o = {\n  key:\n    () => {\n    },\n};\n";
  assertEquals(shapes("a.js", afterColon), ["function key @2 x3"]);
});

Deno.test("a function inside a signature does not take the signature over", () => {
  assertEquals(shapes("a.js", "function a(b = function () {}) {\n}\n"), ["function a @1 x2"]);
});

Deno.test("an anonymous function does not take its name from a call in a default", () => {
  assertEquals(shapes("a.js", "go(function (a = b(1)) {\n});\n"), ["function ? @1 x2"]);
});

Deno.test("a comparison before a function keyword does not hide it", () => {
  const source = "const pick = a < b ? function () {\n} : other;\n";
  assertEquals(shapes("a.js", source), ["function pick @1 x2"]);
});

Deno.test("a class word after a dot is a value", () => {
  assertEquals(shapes("a.js", "el.class\n{\n}\n"), []);
});

Deno.test("a class expression takes the name of what holds it, past extends", () => {
  assertEquals(shapes("a.js", "const Box = class extends Base {\n};\n"), ["class Box @1 x2"]);
  assertEquals(shapes("A.java", "class Box implements Run {\n}\n"), ["class Box @1 x2"]);
});

Deno.test("a call before a control word is no head of the block after it", () => {
  assertEquals(shapes("a.js", "setup(x)\nif (ready) {\n}\n"), []);
});

Deno.test("a call before an export default is no head of the object after it", () => {
  assertEquals(shapes("a.js", 'use(plugin)\n\nexport default {\n  name: "a",\n}\n'), []);
});
