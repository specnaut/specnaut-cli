import { assertEquals, assertThrows } from "@std/assert";
import { assertSafeDestination, isInside } from "../../src/domain/destination.ts";
import { hasControl } from "../../src/domain/terminal_text.ts";

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

Deno.test("assertSafeDestination rejects the target directory itself (cli#669)", () => {
  for (const dest of [".", "./", "", "a/..", "a/b/../..", "a/../"]) {
    assertThrows(() => assertSafeDestination(dest), Error, "target directory itself", dest);
  }
  // Names that merely start with a dot are files.
  assertSafeDestination(".claude");
  assertSafeDestination("./a.md");
});

Deno.test("assertSafeDestination rejects a name the filesystem may read differently (cli#669)", () => {
  // A trailing separator follows a leaf link; Windows drops trailing dots and spaces.
  for (const dest of ["x/", "a/b/", "...", "a/...", "a.", "a/b /c.md", "a/c.md "]) {
    assertThrows(() => assertSafeDestination(dest), Error, "read differently", dest);
  }
  assertSafeDestination("a.b/c.md");
  assertSafeDestination(".specnaut/memory/size-limits.md");
});

// `isInside` is the pure half of containment (cli#574). The filesystem half —
// resolving symlinks on both sides — lives in the adapter; everything below is
// decidable from two strings.
Deno.test("isInside accepts a path beneath the root, and the root itself", () => {
  assertEquals(isInside("/p", "/p/a/b.md"), true);
  assertEquals(isInside("/p", "/p"), true, "a root is not outside itself");
});

Deno.test("isInside refuses a path above or beside the root", () => {
  assertEquals(isInside("/p", "/p/.."), false);
  assertEquals(isInside("/p", "/outside/x.md"), false);
});

Deno.test("isInside is not a string prefix test", () => {
  // The case a `startsWith` implementation gets wrong on EVERY platform, not
  // just on Windows: `/a/bc` starts with `/a/b` while being nowhere inside it.
  // Without this assertion the cheap wrong implementation passes the suite.
  assertEquals(isInside("/a/b", "/a/bc/secret.md"), false);
});

Deno.test("isInside answers on the host's separator", () => {
  // `relative()` returns the HOST's separator, so a hardcoded `../` in the
  // predicate is a Windows-only silent pass — the bug `pruneEmptyParents`
  // already shipped once. Asserting the escape is refused here catches it on
  // whichever platform CI is running.
  const root = Deno.build.os === "windows" ? "C:\\p" : "/p";
  const out = Deno.build.os === "windows" ? "C:\\outside\\x.md" : "/outside/x.md";
  assertEquals(isInside(root, out), false);
});

Deno.test("assertSafeDestination refuses a control character, and names it escaped", () => {
  // A lock key is repository-supplied (cli#574); a control character in it is no
  // file name anyone meant, and its refusal reaches a terminal.
  for (const dest of ["a\x1b[2Jb.md", "a\0b", "a\nb.md", "a\x7fb", "a\x9bb", "dir\x07/c.md"]) {
    const err = assertThrows(() => assertSafeDestination(dest), Error, "control character", dest);
    assertEquals(hasControl(err.message), false, `raw control in: ${JSON.stringify(err.message)}`);
  }
  assertThrows(() => assertSafeDestination("a\x1bb"), Error, "a\\u001bb");
});

Deno.test("assertSafeDestination shows the destination through terminalText in every refusal", () => {
  // A format character is no control and passes the rule above, so each other
  // refusal must still render the name escaped.
  for (const dest of ["/‮.md", "‮/..", "../‮", "‮. "]) {
    const err = assertThrows(() => assertSafeDestination(dest), Error, "Unsafe destination");
    assertEquals(err.message.includes("‮"), false, JSON.stringify(err.message));
    assertEquals(err.message.includes("\\u202e"), true, JSON.stringify(err.message));
  }
});
