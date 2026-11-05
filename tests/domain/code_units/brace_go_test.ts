import { assertEquals } from "@std/assert";
import { shapes } from "./_shapes.ts";

const GO_DESK = [
  "package shop", //  1
  "", //  2
  "type Clock interface {", //  3
  "\tNow() int64", //  4
  "}", //  5
  "", //  6
  "type Desk struct {", //  7
  "\topen chan struct{}", //  8
  "\tnote string", //  9
  "}", // 10
  "", // 11
  "type (", // 12
  "\tPair struct {", // 13
  "\t\ta, b int", // 14
  "\t}", // 15
  ")", // 16
  "", // 17
  "var seen = map[string]struct{}{}", // 18
  "var hook func(int) int", // 19
  "", // 20
  "func New(cb func(int) int, opts interface{}) *Desk {", // 21
  "\ts := `raw { string`", // 22
  "\tr := '{'", // 23
  "\tgo func() {", // 24
  "\t\tcb(1)", // 25
  "\t}()", // 26
  "\t_, _ = s, r", // 27
  "\treturn &Desk{}", // 28
  "}", // 29
  "", // 30
  "func (d *Desk) Close() (int, error) {", // 31
  "\treturn 0, nil", // 32
  "}", // 33
  "", // 34
  "func Map[T any](xs []T) interface{} {", // 35
  "\treturn nil", // 36
  "}", // 37
  "",
].join("\n");

Deno.test("Go: types, a group, receivers, closures and interface{} in a signature", () => {
  assertEquals(shapes("desk.go", GO_DESK), [
    "class Clock @3 x3",
    "class Desk @7 x4",
    "class Pair @13 x3",
    "function New @21 x9",
    "function ? @24 x3",
    "function Close @31 x3",
    "function Map @35 x3",
  ]);
});

Deno.test("Go: a function value on its own line does not claim the next block", () => {
  const source = ["var hook func(int) int", "if ready {", "}", ""].join("\n");
  assertEquals(shapes("a.go", source), []);
});

const GO_HEADS_THAT_STAY = [
  "const window = 4 << 10", //  1
  "", //  2
  "type Conn struct {", //  3
  "\tn int", //  4
  "}", //  5
  "", //  6
  "func (c *Conn) copier(a int) func(b int) {", //  7
  "\treturn nil", //  8
  "}", //  9
  "", // 10
  "func (c *Conn) Done() <-chan struct{} {", // 11
  "\treturn nil", // 12
  "}", // 13
  "", // 14
  "var hooks = []func(){a, b}", // 15
  "", // 16
  "func pick(x any) {", // 17
  "\tswitch x.(type) {", // 18
  "\tcase interface{ Close() }:", // 19
  "\t}", // 20
  "\treturn struct{ a int }{1}", // 21
  "}", // 22
  "",
].join("\n");

Deno.test("Go: a function type, a channel return and a shift never move a head", () => {
  assertEquals(shapes("a.go", GO_HEADS_THAT_STAY), [
    "class Conn @3 x3",
    "function copier @7 x3",
    "function Done @11 x3",
    "function pick @17 x6",
  ]);
});

const GO_SPLIT_SIGNATURES = [
  "func Open(",
  "\tname string,",
  ") error {",
  "\tgo func(a int) (int, error) {",
  "\t}(1)",
  "\trun(struct{}{})",
  "}",
  "",
  "type Set struct {",
  "\tseen map[string]struct{}",
  "}",
  "",
].join("\n");

Deno.test("Go: a signature over several lines, and an anonymous one with named returns", () => {
  assertEquals(shapes("a.go", GO_SPLIT_SIGNATURES), [
    "function Open @1 x7",
    "function ? @4 x2",
    "class Set @9 x3",
  ]);
});

Deno.test("Go: a generic type is a class; a bracket on the line before hides nothing", () => {
  const source = [
    "type Cache[K comparable, V any] struct {",
    "\tm map[K]V",
    "}",
    "",
    "var seen Cache[string, bool]",
    "",
    "func isSeen(a string) bool {",
    "\treturn false",
    "}",
    "",
    "var rows = []struct{ a int }{}",
    "var used = map[string]struct{}{}",
    "",
  ].join("\n");
  assertEquals(shapes("a.go", source), ["class Cache @1 x3", "function isSeen @7 x3"]);
});
