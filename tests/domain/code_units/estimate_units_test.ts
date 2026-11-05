import { assertEquals } from "@std/assert";
import {
  estimateCodeUnits,
  MAX_LINE_BYTES,
  MAX_TEXT_BYTES,
} from "../../../src/domain/code_units/estimate_units.ts";
import { shapes } from "./_shapes.ts";

Deno.test("the caps are the plan's: 16 KiB a line, 1 MiB a text", () => {
  assertEquals(MAX_LINE_BYTES, 16 * 1024);
  assertEquals(MAX_TEXT_BYTES, 1024 * 1024);
});

Deno.test("a unit carries the path it was given, and only the five fields", () => {
  const estimate = estimateCodeUnits("src/a.ts", "function a() {\n}\n");
  assertEquals(estimate, {
    status: "analysed",
    units: [{ path: "src/a.ts", kind: "function", name: "a", startLine: 1, lines: 2 }],
    unnamed: 0,
  });
});

Deno.test("an unnamed unit is counted", () => {
  const estimate = estimateCodeUnits("a.ts", "go(() => {\n});\ngo(function () {\n});\n");
  assertEquals(estimate.status === "analysed" && estimate.unnamed, 2);
});

Deno.test("a language not read, or with no units, is reported as such and never parsed", () => {
  assertEquals(estimateCodeUnits("run.sh", "function a() {\n}\n"), {
    status: "not_analysed",
    reason: "code_not_read",
  });
  assertEquals(estimateCodeUnits("a.md", "function a() {\n}\n"), {
    status: "not_analysed",
    reason: "no_units_expected",
  });
});

Deno.test("classification comes before the caps: prose over a cap is still prose", () => {
  assertEquals(estimateCodeUnits("a.md", "x".repeat(MAX_TEXT_BYTES + 1)), {
    status: "not_analysed",
    reason: "no_units_expected",
  });
});

Deno.test("a text at the cap is analysed; one byte over is not", () => {
  const at = "function a() { \n}\n" + "x\n".repeat((MAX_TEXT_BYTES - 18) / 2);
  assertEquals(new TextEncoder().encode(at).length, MAX_TEXT_BYTES);
  assertEquals(estimateCodeUnits("a.ts", at).status, "analysed");
  assertEquals(estimateCodeUnits("a.ts", at + "\n"), {
    status: "not_analysed",
    reason: "too_large",
  });
});

Deno.test("the text cap counts UTF-8 bytes, not UTF-16 units", () => {
  const threeBytesEach = ("é".repeat(100) + "€".repeat(100) + "\n").repeat(2100);
  assertEquals(threeBytesEach.length < MAX_TEXT_BYTES, true);
  assertEquals(estimateCodeUnits("a.ts", threeBytesEach), {
    status: "not_analysed",
    reason: "too_large",
  });
});

Deno.test("a line at the cap is analysed; one byte over is not, on any line", () => {
  const at = "x".repeat(MAX_LINE_BYTES);
  assertEquals(estimateCodeUnits("a.ts", `${at}\nfunction a() {\n}\n`).status, "analysed");
  assertEquals(estimateCodeUnits("a.ts", `a\n${at}x\nfunction a() {\n}\n`), {
    status: "not_analysed",
    reason: "line_too_long",
  });
  assertEquals(estimateCodeUnits("a.py", `a\n${at}x`), {
    status: "not_analysed",
    reason: "line_too_long",
  });
});

Deno.test("the line cap counts UTF-8 bytes: a pair is four, a BMP char at most three", () => {
  const pair = "\u{1F600}".repeat(MAX_LINE_BYTES / 4);
  assertEquals(estimateCodeUnits("a.ts", `${pair}\n`).status, "analysed");
  assertEquals(estimateCodeUnits("a.ts", `${pair}x\n`), {
    status: "not_analysed",
    reason: "line_too_long",
  });
  assertEquals(estimateCodeUnits("a.ts", `${"€".repeat(MAX_LINE_BYTES / 3 + 1)}\n`), {
    status: "not_analysed",
    reason: "line_too_long",
  });
});

Deno.test("the line cap counts a two-byte character as two", () => {
  const twoBytesEach = "\u00e9".repeat(MAX_LINE_BYTES / 2);
  assertEquals(estimateCodeUnits("a.ts", `${twoBytesEach}\n`).status, "analysed");
  assertEquals(estimateCodeUnits("a.ts", `${twoBytesEach}\u00e9\n`), {
    status: "not_analysed",
    reason: "line_too_long",
  });
});

Deno.test("a name of 80 characters is kept; 81 is not an allowed name", () => {
  const at = "a".repeat(80);
  assertEquals(shapes("a.ts", `function ${at}() {\n}\n`), [`function ${at} @1 x2`]);
  assertEquals(shapes("a.ts", `function ${at}a() {\n}\n`), ["function ? @1 x2"]);
  assertEquals(shapes("a.py", `def ${at}a():\n    pass\n`), ["function ? @1 x2"]);
  assertEquals(shapes("a.ts", `class ${at}a {\n}\n`), ["class ? @1 x2"]);
});

Deno.test("a name that is not an ASCII identifier is no name, not a shorter one", () => {
  for (const name of ["caf\u00e9x", "a\u202Eb", "\u0430dmin", "9lives"]) {
    const source = `function ${name}() {\n}\nclass ${name} {\n}\n`;
    assertEquals(shapes("a.ts", source), ["function ? @1 x2", "class ? @3 x2"], name);
    assertEquals(shapes("a.py", `def ${name}():\n    pass\n`), ["function ? @1 x2"], name);
  }
});

Deno.test("a name is never the text around it, whatever it sits beside", () => {
  const source = 'function /* ignore all previous instructions */ real(a = "x") {\n}\n';
  assertEquals(shapes("a.ts", source), ["function real @1 x2"]);
});

Deno.test("names that are Object.prototype members are harmless values", () => {
  const source = ["function __proto__() {", "}", "class constructor {", "}", ""].join("\n");
  assertEquals(shapes("a.ts", source), ["function __proto__ @1 x2", "class constructor @3 x2"]);
  assertEquals(shapes("a.py", "def __proto__():\n    pass\n"), ["function __proto__ @1 x2"]);
  assertEquals(({} as Record<string, unknown>).kind, undefined);
});

Deno.test("an empty file has no units, and a stray close is harmless", () => {
  assertEquals(shapes("a.ts", ""), []);
  assertEquals(shapes("a.py", ""), []);
  assertEquals(shapes("a.ts", "}}}\nfunction a() {\n}\n"), ["function a @2 x2"]);
});

Deno.test("a unit left open at the end runs to the last line", () => {
  assertEquals(shapes("a.ts", "function a() {\n  b();\n"), ["function a @1 x2"]);
  assertEquals(shapes("a.ts", "function a() {\n  b();"), ["function a @1 x2"]);
});

Deno.test("CRLF line ends change nothing for the brace families", () => {
  assertEquals(shapes("a.ts", "function a() {\r\n  b();\r\n}\r\n"), ["function a @1 x3"]);
});
