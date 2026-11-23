import { assertEquals } from "@std/assert";
import { commandPaths } from "../../src/domain/command_targets.ts";
import { pathPieces } from "../../src/domain/command_search_path.ts";

/**
 * An empty element of a PATH value — a leading, trailing or doubled separator — is the working
 * folder to a shell and to Windows, as `.` is: it is read as `.`, the project's folder.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const none = (_path: string) => false;
const spanned = (command: string) =>
  commandPaths(".claude/commands/c.md", enc(`Run !\`${command}\` first.\n`), none);

Deno.test("an empty PATH element is read as the working folder, for both separators", () => {
  for (const sep of [":", ";"]) {
    for (const value of [`${sep}tools`, `tools${sep}`, `tools${sep}${sep}bin`]) {
      assertEquals(pathPieces(value).includes("."), true, value);
    }
  }
  assertEquals(pathPieces("tools:bin").includes("."), false);
});

Deno.test("a command whose PATH holds an empty element puts the project's folder on PATH", () => {
  for (const value of [":tools", "tools:", "tools::$PATH", ";tools", "tools;;$PATH"]) {
    const found = spanned(`PATH='${value}' lint`);
    assertEquals(found.onPath.includes(""), true, value);
  }
  assertEquals(spanned("PATH='tools:$PATH' lint").onPath.includes(""), false);
});

Deno.test("the separator joining an appended value to the PATH before it is no empty element", () => {
  const joined = [
    "PATH+=:tools lint",
    "$env:Path += ';tools'; lint",
    "$env:Path = $env:Path + ';tools'",
  ];
  for (const command of joined) assertEquals(spanned(command).onPath.includes(""), false, command);
  const empty = ["PATH+=::tools lint", "$env:Path += ';;tools'; lint", "$env:Path = ';tools'"];
  for (const command of empty) assertEquals(spanned(command).onPath.includes(""), true, command);
});
