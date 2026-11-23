import { assertEquals } from "@std/assert";
import { normalizedPowerShell, quotedEnd, writtenAs } from "../../src/domain/powershell_text.ts";

/**
 * PowerShell's text as its tokenizer reads it: each rule shown with letters no escape stands for
 * (``Pat`h`` is `Path`), so a test reads the rule and not the escape table.
 */

const read = (text: string) => normalizedPowerShell(text).text;
const literal = (text: string) => normalizedPowerShell(text, "literal").text;

Deno.test("a backtick outside a string escapes the character after it", () => {
  assertEquals(read("${env:Pat`h} = 'tools'"), "${env:Path} = 'tools'");
  assertEquals(read("Set-Ite`m env:Path"), "Set-Item env:Path");
});

Deno.test("an escape of the table stands for its character, `u{…}` for its code point", () => {
  assertEquals(read("a`nb`tc"), "a\nb\tc");
  assertEquals(read("`u{50}ath `0`a`b`e`f`r`v"), "Path \0\x07\b\x1b\f\r\v");
});

Deno.test("a backtick at a line's end is taken off with the line break", () => {
  assertEquals(read("$env:Pa`\nth = 1"), "$env:Path = 1");
  assertEquals(read("$env:Path `\r\n= 1"), "$env:Path = 1");
});

Deno.test("a block comment and a line comment are taken off outside strings", () => {
  assertEquals(read("$env:Path <#c#>= 1"), "$env:Path = 1");
  assertEquals(read("$env:Path<#a\nb#>+= 1 # c\nlint"), "$env:Path+= 1 \nlint");
});

Deno.test("a comment inside a string survives, and the string is left as written", () => {
  assertEquals(read("'a # b' <#c#>"), "'a # b' ");
  assertEquals(read('"a <#c#> Pat`h" # c'), '"a <#c#> Pat`h" ');
  assertEquals(read("'it''s # x' # c"), "'it''s # x' ");
  assertEquals(read("@'\na # b\n'@ # c"), "@'\na # b\n'@ ");
  assertEquals(read('@"\na `" # b\n"@ # c'), '@"\na `" # b\n"@ ');
  assertEquals(read("\u2018a # b\u2019 # c"), "\u2018a # b\u2019 ");
});

Deno.test("a subexpression inside a double-quoted string is read as code", () => {
  assertEquals(read('"x $(Pat`h <#c#>) y # z"'), '"x $(Path ) y # z"');
  assertEquals(read('"$("Pat`h")"'), '"$("Pat`h")"');
});

Deno.test("a braced variable's name is read through its escapes, its `#` kept", () => {
  assertEquals(read("${a#b} # c"), "${a#b} ");
});

Deno.test("a `#` inside a token is a comment in one reading and a character in the other", () => {
  assertEquals(read("Write-Output a#b; x"), "Write-Output a");
  assertEquals(literal("Write-Output a#b; x"), "Write-Output a#b; x");
  assertEquals(literal("x # c"), "x ");
  // In the literal reading a string opened in such a token ends at its line's end.
  assertEquals(literal("a#'b\n${env:Pat`h} = 1"), "a#'b\n${env:Path} = 1");
});

Deno.test("each character left as written says so; a decoded or joined one does not", () => {
  const plain = normalizedPowerShell("x; $env:Path = 1");
  assertEquals(writtenAs(plain, 3, 12), true);
  const escaped = normalizedPowerShell("${env:Pat`h} = 1");
  assertEquals(writtenAs(escaped, 0, 11), false);
  const joined = normalizedPowerShell("$env:Path<#c#>= 1");
  assertEquals([writtenAs(joined, 0, 9), writtenAs(joined, 0, 10)], [true, false]);
});

Deno.test("a quoted string ends past its closing quote, a doubled quote inside it", () => {
  assertEquals(quotedEnd("'it''s' x", 0), 7);
  assertEquals(quotedEnd('"a`"b" x', 0), 6);
  assertEquals(quotedEnd('"$(")")" x', 0), 8);
  assertEquals(quotedEnd("@'\na'\n'@ x", 0), 8);
  assertEquals(quotedEnd("'open", 0), 5);
});
