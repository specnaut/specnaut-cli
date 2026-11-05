import { assertEquals } from "@std/assert";
import { shapes } from "./_shapes.ts";

const JS_DECLARATIONS = [
  "const api = {", //  1
  "  load() {", //  2
  "    return 1", //  3
  "  },", //  4
  "  save: function () {", //  5
  "  },", //  6
  "  run: async () => {", //  7
  "  },", //  8
  "}", //  9
  "function* walk(tree) {", // 10
  "  yield tree", // 11
  "}", // 12
  "describe('a {', function () {", // 13
  "  it('b }', async () => {", // 14
  "    items.map((x) => {", // 15
  "      return x", // 16
  "    })", // 17
  "  })", // 18
  "})", // 19
  "",
].join("\n");

Deno.test("JS: declarations, expressions, callbacks and object members", () => {
  assertEquals(shapes("a.js", JS_DECLARATIONS), [
    "function load @2 x3",
    "function save @5 x2",
    "function run @7 x2",
    "function walk @10 x3",
    "function ? @13 x7",
    "function ? @14 x5",
    "function ? @15 x3",
  ]);
});

Deno.test("JS: a destructured parameter and a default object are not the body", () => {
  const source = [
    "export function card({ title, items = [] }, opts = {}) {",
    "  return title;",
    "}",
    "class Card {",
    "  render({ a, b }, { c }) {",
    "    return a;",
    "  }",
    "}",
    "",
  ].join("\n");
  assertEquals(shapes("a.jsx", source), [
    "function card @1 x3",
    "class Card @4 x5",
    "function render @5 x3",
  ]);
});

Deno.test("JS: members of an object handed to a call are still found", () => {
  const source = ["define({", "  setup() {", "    return 1;", "  },", "});", ""].join("\n");
  assertEquals(shapes("a.js", source), ["function setup @2 x3"]);
});

Deno.test("JS: an arrow is a function, with or without a body of its own", () => {
  const source = [
    "const twice = (n) => n * 2;",
    "const wrap = () => ({",
    "  a: 1,",
    "});",
    "const named =",
    "  (a) =>",
    "  {",
    "    return a;",
    "  };",
    "",
  ].join("\n");
  assertEquals(shapes("a.js", source), ["function wrap @2 x3", "function named @5 x5"]);
});

Deno.test("JS: a comparison with no semicolon does not hide the next head", () => {
  const source = ["const small = a < b", "class Card {", "}", "const also = c < d", "e() ", ""];
  assertEquals(shapes("a.js", source.join("\n")), ["class Card @2 x2"]);
});

Deno.test("JS: a generic list may span lines without losing the function's name", () => {
  const source = ["function pick<", "  T,", "  U,", ">(a) {", "}", ""].join("\n");
  assertEquals(shapes("a.ts", source), ["function pick @1 x5"]);
});

Deno.test("JS: a value's name is not the name of a callback inside it", () => {
  const source = [
    "const doubled = items.map((x) => {",
    "});",
    "const found = items.find(function (x) {",
    "});",
    "",
  ].join("\n");
  assertEquals(shapes("a.js", source), ["function ? @1 x2", "function ? @3 x2"]);
});

Deno.test("JS: an assignment's name lasts only as long as its value", () => {
  const source = [
    "const pair = {",
    "  a: 1, b: () => {",
    "  },",
    "};",
    "class Fields {",
    "  first = 1",
    "  second = () => {",
    "  }",
    "}",
    "",
  ].join("\n");
  assertEquals(shapes("a.js", source), [
    "function b @2 x2",
    "class Fields @5 x5",
    "function second @7 x2",
  ]);
});

Deno.test("JS: a comparison inside the parens leaves the method whole", () => {
  const source = ["class A {", "  run(a = b < c, d = check(1)) {", "  }", "}", ""].join("\n");
  assertEquals(shapes("a.js", source), ["class A @1 x4", "function run @2 x2"]);
});

const JS_METHODS = [
  "class A {",
  "  #hidden() {",
  "  }",
  "  [Symbol.iterator]() {",
  "  }",
  "  static async *stream() {",
  "  }",
  "  field = 1",
  "  after() {",
  "  }",
  "}",
  "",
].join("\n");

Deno.test("JS: a private, computed, static and async generator method", () => {
  assertEquals(shapes("a.js", JS_METHODS), [
    "class A @1 x11",
    "function hidden @2 x2",
    "function ? @4 x2",
    "function stream @6 x2",
    "function after @9 x2",
  ]);
});

Deno.test("JS: a regex and a string holding braces do not move any extent", () => {
  const source = [
    "function scan(text) {",
    "  const open = /\\{/;",
    "  const set = /[}{]/;",
    "  const half = text.length / 2; // {",
    '  return text.replace(/"/g, "\'") + open + set + half;',
    "}",
    "function after() {",
    "}",
    "",
  ].join("\n");
  assertEquals(shapes("a.js", source), ["function scan @1 x6", "function after @7 x2"]);
});

Deno.test("TSX: JSX text with an apostrophe costs at most its line", () => {
  const source = [
    "export const Card = () => {",
    "  return (",
    "    <p onClick={() => {",
    "      go();",
    "    }}>don't stop</p>",
    "  );",
    "};",
    "",
  ].join("\n");
  assertEquals(shapes("a.tsx", source), ["function Card @1 x7", "function ? @3 x3"]);
});
