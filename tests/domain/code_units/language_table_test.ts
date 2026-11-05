import { assertEquals } from "@std/assert";
import { classifyPath } from "../../../src/domain/code_units/language_table.ts";

function familyOf(path: string): string {
  const c = classifyPath(path);
  return c.kind === "read" ? c.family.id : c.kind;
}

/** Each extension FR-006 names, and the family it reads as. */
const FAMILY_BY_EXTENSION: ReadonlyArray<[string, string]> = [
  ["a.ts", "typescript"],
  ["a.tsx", "typescript"],
  ["a.mts", "typescript"],
  ["a.js", "javascript"],
  ["a.jsx", "javascript"],
  ["a.cjs", "javascript"],
  ["a.go", "go"],
  ["a.java", "java"],
  ["a.cs", "csharp"],
  ["a.rs", "rust"],
  ["a.php", "php"],
  ["a.swift", "swift"],
  ["a.kt", "kotlin"],
  ["a.kts", "kotlin"],
  ["a.c", "c"],
  ["a.cpp", "cpp"],
  ["a.cc", "cpp"],
  ["a.hpp", "cpp"],
  ["a.h", "cpp"],
  ["a.py", "python"],
  ["a.pyi", "python"],
];

Deno.test("every language FR-006 names maps to its family, by extension", () => {
  for (const [path, family] of FAMILY_BY_EXTENSION) assertEquals(familyOf(path), family, path);
});

Deno.test("indentation reads Python only; every other family reads braces", () => {
  for (
    const path of ["a.ts", "a.go", "a.c", "a.php", "a.rs", "a.swift", "a.kt", "a.cs", "a.java"]
  ) {
    const c = classifyPath(path);
    assertEquals(c.kind === "read" && c.family.extents, "brace", path);
  }
  const python = classifyPath("a.py");
  assertEquals(python.kind === "read" && python.family.extents, "indent");
});

Deno.test("prose and data expect no units", () => {
  for (
    const path of ["README.md", "a.json", "a.yml", "a.yaml", "a.toml", "a.txt", "a.css", "a.html"]
  ) {
    assertEquals(familyOf(path), "no_units_expected", path);
  }
});

Deno.test("anything unlisted may be code, so it is never read as having no units", () => {
  const notRead = ["run.sh", "run.ps1", "a.rb", "a.lua", "Makefile", ".gitignore", "a.unknown"];
  for (const path of notRead) assertEquals(familyOf(path), "code_not_read", path);
});

Deno.test("the extension is the file's own, and case does not change it", () => {
  assertEquals(familyOf("src/a.ts/run"), "code_not_read");
  assertEquals(familyOf("dir.py/a.go"), "go");
  assertEquals(familyOf("LIB/MAIN.PY"), "python");
  assertEquals(familyOf("trailing."), "code_not_read");
  assertEquals(familyOf("a.py."), "code_not_read");
  assertEquals(familyOf(".py"), "code_not_read");
  assertEquals(familyOf("src/.py"), "code_not_read");
});

Deno.test("an extension named after an Object.prototype member is just an unknown one", () => {
  for (const path of ["a.__proto__", "a.constructor", "a.toString", "a.hasOwnProperty"]) {
    assertEquals(familyOf(path), "code_not_read", path);
  }
});
