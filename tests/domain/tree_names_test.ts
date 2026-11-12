import { assertEquals } from "@std/assert";
import { foldKey, instructionPath, nameFault } from "../../src/domain/tree_names.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const fault = (s: string | Uint8Array, windows = false) =>
  nameFault(typeof s === "string" ? enc(s) : s, windows);

Deno.test("an ordinary name passes", () => {
  for (
    const ok of ["a", "README.md", ".gitignore", ".github", "\u00e9.txt", "git", "a.git", "\ufeffa"]
  ) {
    assertEquals(fault(ok), null, ok);
  }
});

Deno.test("empty, dot and dot-dot are refused", () => {
  assertEquals(fault(""), "an empty name");
  assertEquals(fault("."), "a '.' or '..' step");
  assertEquals(fault(".."), "a '.' or '..' step");
});

Deno.test("every spelling of .git is refused", () => {
  for (
    const spelling of [
      ".git",
      ".GIT",
      ".Git",
      ".git.",
      ".git ",
      ".git. . ",
      ".git::$INDEX_ALLOCATION",
      "git~1",
      "GIT~1",
      ".g\u200cit", // an HFS+ ignorable code point inside the name
      ".git\ufeff",
    ]
  ) {
    assertEquals(fault(spelling), "a spelling of .git", JSON.stringify(spelling));
  }
});

Deno.test("a separator, NUL or control character is refused", () => {
  assertEquals(fault("a/b"), "a path separator");
  assertEquals(fault("a\\b"), "a path separator");
  assertEquals(fault(new Uint8Array([0x61, 0x00, 0x62])), "a NUL byte");
  for (const c of ["\x01", "\n", "\r", "\t", "\x1b", "\x7f", "\u0085", "\u009b"]) {
    assertEquals(fault(`a${c}b`), "a control character", JSON.stringify(c));
  }
});

Deno.test("a name that is not UTF-8 is refused", () => {
  assertEquals(fault(new Uint8Array([0x61, 0xff, 0x62])), "a name that is not UTF-8");
  assertEquals(fault(new Uint8Array([0xc3])), "a name that is not UTF-8");
});

Deno.test("a name over 255 bytes is refused, 255 passes", () => {
  assertEquals(fault("a".repeat(255)), null);
  assertEquals(fault("a".repeat(256)), "a name over 255 bytes");
  assertEquals(fault("\u00e9".repeat(128)), "a name over 255 bytes");
});

Deno.test("on Windows, reserved characters and device names are refused too", () => {
  for (const name of ["a:b", "a<b", "a>b", 'a"b', "a|b", "a?b", "a*b"]) {
    assertEquals(fault(name, true), "a character Windows reserves", name);
    assertEquals(fault(name, false), null, name);
  }
  const devices = ["CON", "nul.txt", "Aux.c", "com1", "LPT9.log", "prn ", "CONIN$", "conout$.txt"];
  for (const name of [...devices, "COM0", "lpt\u00b9", "com\u00b3.x", "nul .txt"]) {
    assertEquals(fault(name, true), "a Windows device name", name);
  }
  assertEquals(fault("console", true), null);
  assertEquals(fault("com10", true), null);
});

Deno.test("on Windows, a name ending in a dot or a space is refused: Windows would trim it", () => {
  for (const name of ["a.", "a ", "notes. "]) {
    assertEquals(fault(name, true), "a name Windows would trim", JSON.stringify(name));
    assertEquals(fault(name, false), null, JSON.stringify(name));
  }
});

Deno.test("names that one filesystem would merge fold to one key", () => {
  assertEquals(foldKey("README"), foldKey("readme"));
  assertEquals(foldKey("caf\u00e9"), foldKey("cafe\u0301"), "NFC and NFD forms");
  assertEquals(foldKey("a."), foldKey("a"), "Windows drops trailing dots");
  assertEquals(foldKey("a "), foldKey("a"), "Windows drops trailing spaces");
  assertEquals(foldKey("a\u200cb"), foldKey("ab"), "HFS+ ignores some code points");
  assertEquals(foldKey("STRASSE") === foldKey("strasse"), true);
  assertEquals(foldKey("a") === foldKey("b"), false);
});

/** Instruction and harness config files, as path names, at the root and below it. */
const INSTRUCTION_PATHS: readonly string[][] = [
  ["CLAUDE.md"],
  ["pkg", "claude.md"],
  ["CLAUDE.local.md"],
  ["AGENTS.md"],
  ["deep", "x", "Agents.override.md"],
  ["GEMINI.md"],
  [".mcp.json"],
  [".cursorrules"],
  [".claude"],
  [".claude", "settings.json"],
  ["sub", ".codex", "config.toml"],
  [".cursor", "rules", "a.mdc"],
  [".agents", "skills", "x", "SKILL.md"],
  [".vscode", "settings.json"],
  [".specnaut", "workflow.yml"],
  [".github", "copilot-instructions.md"],
  [".github", "instructions", "a.instructions.md"],
  [".github", "prompts"],
];

Deno.test("an instruction or harness config file is recognised at any depth", () => {
  for (const path of INSTRUCTION_PATHS) assertEquals(instructionPath(path), true, path.join("/"));
});

Deno.test("an ordinary file is not an instruction file", () => {
  for (
    const path of [
      ["README.md"],
      ["src", "claude.ts"],
      ["docs", "AGENTS.md.txt"],
      [".github", "workflows", "ci.yml"],
      ["x", ".github", "CODEOWNERS"],
      ["claude"],
    ]
  ) {
    assertEquals(instructionPath(path), false, path.join("/"));
  }
});
