import { assertEquals } from "@std/assert";
import { CharRole, classifyChars } from "../../../src/domain/code_units/lexical_state.ts";
import { classifyPath } from "../../../src/domain/code_units/language_table.ts";

/** What the extent scanners may see: code as is, every other character as a dot. */
function codeOf(path: string, source: string): string {
  const c = classifyPath(path);
  if (c.kind !== "read") throw new Error(`no family for ${path}`);
  const mask = classifyChars(source, c.family.lexical);
  let out = "";
  for (let i = 0; i < source.length; i++) out += mask[i] === CharRole.Code ? source[i] : ".";
  return out;
}

Deno.test("a string hides its braces, escapes included", () => {
  assertEquals(codeOf("a.ts", `a("{\\"}");b`), `a(......);b`);
  assertEquals(codeOf("a.ts", `a('{\\'}');b`), `a(......);b`);
});

Deno.test("a single-line string that never closes ends at its line", () => {
  assertEquals(codeOf("a.ts", `a = "{\nb{`), `a = ..\nb{`);
  assertEquals(codeOf("a.py", `a = '{\nb{`), `a = ..\nb{`);
});

Deno.test("an escaped newline keeps a single-line string open, on CRLF too", () => {
  assertEquals(codeOf("a.c", `"a\\\n{"b`), `......b`);
  assertEquals(codeOf("a.c", `"a\\\r\n{"b`), `.......b`);
});

Deno.test("code, comment and string text are three roles, every delimiter included", () => {
  const c = classifyPath("a.py");
  if (c.kind !== "read") throw new Error("python must be read");
  const source = `a="""b"""#c`;
  const roles = Array.from(
    classifyChars(source, c.family.lexical),
    (r) => "c.t"[r === 1 ? 0 : r === 0 ? 1 : 2],
  );
  assertEquals(roles.join(""), "cc" + "t".repeat(7) + "..");
});

Deno.test("line and block comments hide their braces", () => {
  assertEquals(codeOf("a.ts", `a//{\nb/*}\n{*/c`), `a...\nb.......c`);
});

Deno.test("an unterminated block comment runs to the end and never throws", () => {
  assertEquals(codeOf("a.ts", `a/*{`), `a...`);
});

Deno.test("a nesting family needs every close; a flat one stops at the first", () => {
  assertEquals(codeOf("a.rs", `/*/*{*/}*/a`), `..........a`);
  assertEquals(codeOf("a.swift", `/*/*{*/}*/a`), `..........a`);
  assertEquals(codeOf("a.kt", `/*/*{*/}*/a`), `..........a`);
  assertEquals(codeOf("a.java", `/*/*{*/}*/a`), `.......}*/a`);
});

Deno.test("a template literal hides its text, and its interpolation is code", () => {
  assertEquals(codeOf("a.ts", "`{${b}}`c"), "....b...c");
  assertEquals(codeOf("a.js", "`{${{x:1}}}`c"), "....{x:1}...c");
});

Deno.test("a template nested in an interpolation returns to the outer text", () => {
  assertEquals(codeOf("a.ts", "`${`${a}{`}{`b"), "......a......b");
});

Deno.test("past the nesting cap an interpolation is plain text, so the state stays bounded", () => {
  const open = "`${";
  assertEquals(codeOf("a.ts", `${open.repeat(64)}x`), `${".".repeat(64 * 3)}x`);
  assertEquals(codeOf("a.ts", `${open.repeat(65)}x`), ".".repeat(65 * 3 + 1));
});

Deno.test("a backtick is a raw string in Go, with no interpolation", () => {
  assertEquals(codeOf("a.go", "`{${a}\n}`b"), ".........b");
});

Deno.test("a character literal hides a brace, and a lifetime stays code", () => {
  assertEquals(codeOf("a.java", `c='{';d`), `c=...;d`);
  assertEquals(codeOf("a.go", `c='\\'';d`), `c=....;d`);
  assertEquals(codeOf("a.rs", `f<'a>(c:&'a str){`), `f<'a>(c:&'a str){`);
  assertEquals(codeOf("a.rs", `'\\u{7d}';d`), `........;d`);
  assertEquals(codeOf("a.cpp", `int a=1'000'000;{`), `int a=1'000'000;{`);
});

Deno.test("a regular expression literal hides its braces in JS and TS", () => {
  assertEquals(codeOf("a.ts", `a=/\\{/;b`), `a=....;b`);
  assertEquals(codeOf("a.js", `a(/[/{]/,b)`), `a(......,b)`);
  assertEquals(codeOf("a.ts", `return /{/.test(a)`), `return ....test(a)`);
  assertEquals(codeOf("a.ts", `b=>/{/.test(a)`), `b=>....test(a)`);
});

Deno.test("an escaped slash stays inside the regular expression", () => {
  assertEquals(codeOf("a.ts", `a=/\\//;{`), `a=....;{`);
});

Deno.test("only JS and TS have regular expression literals", () => {
  assertEquals(codeOf("a.go", `a = /{`), `a = /{`);
  assertEquals(codeOf("a.c", `f(/{`), `f(/{`);
});

Deno.test("a slash after a value is a division, not a regular expression", () => {
  assertEquals(codeOf("a.ts", `a=b/2;{c/d}`), `a=b/2;{c/d}`);
  assertEquals(codeOf("a.ts", `a=(b)/2;{`), `a=(b)/2;{`);
  assertEquals(codeOf("a.ts", `areturn/2/{`), `areturn/2/{`);
  assertEquals(codeOf("a.tsx", `<a/>{b}</a>`), `<a/>{b}</a>`);
  assertEquals(codeOf("a.tsx", `<a>/{b}</a>`), `<a>/{b}</a>`);
});

Deno.test("a regular expression that never closes ends at its line", () => {
  assertEquals(codeOf("a.ts", `a=/{\nb{`), `a=..\nb{`);
});

Deno.test("Python: triple quotes span lines, a hash is a comment", () => {
  assertEquals(codeOf("a.py", `a="""{\n}"""\nb#{`), `a=.........\nb..`);
  assertEquals(codeOf("a.py", `a='''"\n'''b`), `a=........b`);
});

Deno.test("PHP: a hash comments, except the attribute form", () => {
  assertEquals(codeOf("a.php", `#{\n#[A]{`), `..\n#[A]{`);
  assertEquals(codeOf("a.php", `'{\n}'a`), `.....a`);
});

Deno.test("raw and verbatim strings follow their own family", () => {
  assertEquals(codeOf("a.rs", `r#"a"}"#b`), `........b`);
  assertEquals(codeOf("a.rs", `bar"x"`), `bar...`);
  assertEquals(codeOf("a.cs", `@"\\{"b`), `.....b`);
  assertEquals(codeOf("a.cpp", `R"(a"})"b`), `........b`);
  assertEquals(codeOf("a.java", `"""\n{"\n"""b`), `..........b`);
  assertEquals(codeOf("a.swift", `#"a"}"#b`), `.......b`);
  assertEquals(codeOf("a.kt", `"""\n{\n"""b`), `.........b`);
});
