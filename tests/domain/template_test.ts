import { assertThrows } from "@std/assert";
import { assertSafeDestination } from "../../src/domain/template.ts";

Deno.test("assertSafeDestination accepts normal relative paths", () => {
  assertSafeDestination(".claude/commands/hello.md");
  assertSafeDestination("tasks/backlog.md");
  assertSafeDestination("CLAUDE.md");
});

Deno.test("assertSafeDestination rejects absolute paths", () => {
  assertThrows(
    () => assertSafeDestination("/etc/passwd"),
    Error,
    "absolute",
  );
});

Deno.test("assertSafeDestination rejects parent-dir traversal", () => {
  assertThrows(() => assertSafeDestination("../escape.md"), Error, "escape");
  assertThrows(() => assertSafeDestination("a/../../escape.md"), Error, "escape");
});

Deno.test("assertSafeDestination rejects plain '..' and its prefix", () => {
  assertThrows(() => assertSafeDestination(".."), Error, "escape");
});
