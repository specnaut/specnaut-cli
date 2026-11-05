import { assertEquals } from "@std/assert";
import { shapes } from "./_shapes.ts";

const DESK = `"""Module docstring with def fake(): and class Fake:"""
import os


class Desk(Base):
    """Doc.

    def not_a_function():
    """

    LIMIT = {"{": 1}

    def __init__(self, size):
        self.size = size
        # trailing comment

    @property
    def size(
        self,
        other=None,
    ):
        return (
            self.size
        )

    async def place(self, order):
        def nested(x):
            return x

        note = 'def inside string'
        return nested(order) \\
            + 1

    class Inner:
        pass


def helper(): return 1


def last():
    text = """
not indented, still the string
"""
    return text


# comment at the end
`;

Deno.test("Python: classes, methods, nested and async defs, by indentation", () => {
  assertEquals(shapes("desk.py", DESK), [
    "class Desk @5 x31",
    "function __init__ @13 x2",
    "function size @18 x7",
    "function place @26 x7",
    "function nested @27 x2",
    "class Inner @34 x2",
    "function helper @38 x1",
    "function last @41 x5",
  ]);
});

Deno.test("Python: a body that is only a docstring keeps its lines", () => {
  const source = `def documented():
    """One.

    Two.
    """


def next_one():
    pass
`;
  assertEquals(shapes("a.py", source), [
    "function documented @1 x5",
    "function next_one @8 x2",
  ]);
});

Deno.test("Python: a bracket that continues at column zero does not end the unit", () => {
  const source = `def build():
    return [
1,
2,
    ]
`;
  assertEquals(shapes("a.py", source), ["function build @1 x5"]);
});

Deno.test("Python: a tab aligns to the next multiple of eight", () => {
  const source = "class A:\n\tdef a(self):\n\t\tpass\n        def b(self):\n\t\tpass\n";
  assertEquals(shapes("a.py", source), [
    "class A @1 x5",
    "function a @2 x2",
    "function b @4 x2",
  ]);
});

Deno.test("Python: CRLF line ends change nothing, a blank line ending no unit", () => {
  const source =
    "class A:\r\n    def a(self):\r\n        pass\r\n\r\n    def b(self):\r\n        pass\r\n";
  assertEquals(shapes("a.py", source), [
    "class A @1 x6",
    "function a @2 x2",
    "function b @5 x2",
  ]);
});

Deno.test("Python: a backslash continues the logical line, even at column zero", () => {
  const source = "def a():\n    x = 1 \\\n+ 2\n    return x\n";
  assertEquals(shapes("a.py", source), ["function a @1 x4"]);
});

Deno.test("Python: a stray closing bracket does not swallow the rest of the file", () => {
  assertEquals(shapes("a.py", ")\ndef a():\n    pass\n"), ["function a @2 x2"]);
});

Deno.test("Python: a word only starting like a head, and a head word as a value", () => {
  const source = "define = 1\nclassy = 2\nasync_call = 3\nasync = 4\nx = def_value\n";
  assertEquals(shapes("a.py", source), []);
});

Deno.test("Python: a head with no name is counted, not dropped", () => {
  assertEquals(shapes("a.py", "def (x):\n    pass\n"), ["function ? @1 x2"]);
});

Deno.test("Python: a file that ends inside a unit, with and without a final newline", () => {
  assertEquals(shapes("a.py", "def a():\n    pass"), ["function a @1 x2"]);
  assertEquals(shapes("a.py", 'def a():\n    x = """\nnever closed'), ["function a @1 x3"]);
});
