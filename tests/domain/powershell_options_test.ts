import { assertEquals } from "@std/assert";
import { psOption } from "../../src/domain/powershell_options.ts";

/** A PowerShell launcher's options are read by any prefix PowerShell takes, never by one it does not. */

const matching = (words: readonly string[], kind: Parameters<typeof psOption>[1]) =>
  words.filter((w) => psOption(w, kind));

Deno.test("a command is handed by -Command or any prefix of it, and by -CommandWithArgs", () => {
  const words = ["-c", "-Co", "-COMMAND", "/command", "–c", "-cwa", "-CommandWithArgs", "-c:x"];
  assertEquals(matching(words, "command"), words);
  assertEquals(matching(["-config", "-nop", "-f", "c", "-", "-e"], "command"), []);
});

Deno.test("a script file is handed by -File or any prefix of it", () => {
  assertEquals(matching(["-f", "-Fi", "-FILE", "/file", "-file:x.ps1"], "file").length, 5);
  assertEquals(matching(["-files", "-c", "-noprofile", "f"], "file"), []);
});

Deno.test("an encoded command is handed by -EncodedCommand, its prefixes from -e, or -ec, never -ex or -ep", () => {
  assertEquals(
    matching(["-e", "-enc", "-EncodedCommand", "-ec", "/e", "—ec"], "encodedcommand").length,
    6,
  );
  assertEquals(matching(["-ex", "-ep", "-ExecutionPolicy", "-c"], "encodedcommand"), []);
});
