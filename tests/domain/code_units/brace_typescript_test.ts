import { assertEquals } from "@std/assert";
import { shapes } from "./_shapes.ts";

const TYPESCRIPT_CLASS = [
  "export class OrderBook extends Base<{ id: string }> {", //  1
  "  private total = 0;", //  2
  "  constructor(private readonly clock: Clock) {", //  3
  "    super();", //  4
  "  }", //  5
  "  get size(): number {", //  6
  "    return this.total;", //  7
  "  }", //  8
  "  async place({ id, qty }: Order): Promise<{ ok: boolean }> {", //  9
  '    const note = "a } brace in a string";', // 10
  "    // a { brace in a comment", // 11
  "    /* and } another */", // 12
  '    const label = `qty ${qty > 1 ? `${qty}}` : "{"} }`;', // 13
  "    return { ok: label !== note };", // 14
  "  }", // 15
  "  readonly onDone = async (order: Order) => {", // 16
  "    this.total += 1;", // 17
  "  };", // 18
  "}", // 19
  "",
].join("\n");

Deno.test("TS: a class, its constructor, accessor, method and arrow field", () => {
  assertEquals(shapes("src/book.ts", TYPESCRIPT_CLASS), [
    "class OrderBook @1 x19",
    "function constructor @3 x3",
    "function size @6 x3",
    "function place @9 x7",
    "function onDone @16 x3",
  ]);
});

Deno.test("TS: a return type literal is not the body", () => {
  const source = [
    "function shape(a: number): { w: number; h(): void } {",
    "  return { w: a, h() {} };",
    "}",
    "",
  ].join("\n");
  assertEquals(shapes("a.ts", source), ["function shape @1 x3", "function h @2 x1"]);
});

Deno.test("TS: a union of type literals in the return type is not the body", () => {
  const source = [
    "function check(raw: string):",
    "  | { ok: true; value: string }",
    "  | { ok: false } {",
    "  return { ok: false };",
    "}",
    "function both(): { a: 1 } & { b: 2 } {",
    "  return { a: 1, b: 2 };",
    "}",
    "",
  ].join("\n");
  assertEquals(shapes("a.ts", source), ["function check @1 x5", "function both @6 x3"]);
});

Deno.test("TS: a method may be named after an operator", () => {
  const source = ["class Store {", "  delete(key: string) {", "    drop(key);", "  }", "}", ""];
  assertEquals(shapes("a.ts", source.join("\n")), [
    "class Store @1 x5",
    "function delete @2 x3",
  ]);
});

const TS_SIGNATURES = [
  "export function pick(a: string): string;",
  "export function pick(a: number): number;",
  "export function pick(a: unknown): unknown {",
  "  return a;",
  "}",
  "abstract class Shape {",
  "  abstract area(): number;",
  "}",
  "interface Sized {",
  "  size(a: { deep: number }): void;",
  "}",
  "",
].join("\n");

Deno.test("TS: an overload, an abstract method and a signature open nothing", () => {
  assertEquals(shapes("a.ts", TS_SIGNATURES), [
    "function pick @3 x3",
    "class Shape @6 x3",
    "class Sized @9 x3",
  ]);
});

const TS_NOT_UNITS = [
  "type Pair = { a: number };",
  "const pair: Pair = { a: 1 };",
  "if (pair.a > 0) {",
  "  for (const k of Object.keys(pair)) {",
  "    while (k) {",
  "      switch (k) {",
  "        default: {",
  "          break;",
  "        }",
  "      }",
  "    }",
  "  }",
  "} else {",
  "  try {",
  "    run(pair);",
  "  } catch (err) {",
  "    report(err);",
  "  } finally {",
  "    done();",
  "  }",
  "}",
  "",
].join("\n");

Deno.test("TS: control flow, type aliases and object values are not units", () => {
  assertEquals(shapes("a.ts", TS_NOT_UNITS), []);
});
