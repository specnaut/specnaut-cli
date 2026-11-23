import { assertEquals } from "@std/assert";
import { commandPaths } from "../../src/domain/command_targets.ts";

/**
 * Each surface that sets a command's environment is read as its harness reads a `$` there: Claude
 * Code's settings copy a value as typed, `.mcp.json` expands braces alone, Codex documents nothing.
 * A value is looked up both as expanded and as written; what a harness may not expand as a shell
 * would makes the reading not whole.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const none = (_path: string) => false;
const json = (value: unknown) => enc(JSON.stringify(value));
const settings = (PATH: string, path = ".claude/settings.json") =>
  commandPaths(path, json({ env: { PATH } }), none);
const mcp = (PATH: string) =>
  commandPaths(".mcp.json", json({ mcpServers: { s: { command: "serve", env: { PATH } } } }), none);
const sorted = (xs: readonly string[]) => [...xs].sort();

Deno.test("a settings file's env value is copied as typed: one holding `$` is not read whole", () => {
  for (const path of [".claude/settings.json", ".claude/settings.local.json"]) {
    const found = settings("./bin:$PATH", path);
    assertEquals([found.whole, sorted(found.onPath)], [false, ["$PATH", "bin"]], path);
    assertEquals(settings("./bin:/usr/bin", path).whole, true, path);
  }
  for (const PATH of ["~/bin:./bin", "C:\\tools;%PATH%", "`cat .dir`"]) {
    assertEquals(settings(PATH).whole, false, PATH);
  }
});

Deno.test("an .mcp.json env value expands braces alone: `${PATH}` is the PATH in effect", () => {
  const braced = mcp("./bin:${PATH}");
  assertEquals([braced.whole, sorted(braced.onPath)], [true, ["${PATH}", "bin"]]);
  const unread = ["./bin:$PATH", "${CLAUDE_PROJECT_DIR}/bin", "${X:-tools}:${PATH}", "~/bin"];
  assertEquals(unread.filter((PATH) => mcp(PATH).whole), []);
  // An unset variable stays as written: the folder so spelled is looked up too.
  assertEquals(mcp("${TOOLS}").onPath.includes("${TOOLS}"), true);
});

Deno.test("Codex's shell policy and an MCP server's env are read as documenting nothing", () => {
  const policy = (PATH: string) =>
    commandPaths(
      ".codex/config.toml",
      enc(`[shell_environment_policy]\nset = { PATH = "${PATH}" }\n`),
      none,
    );
  assertEquals([policy("vendor/bin:/usr/bin").whole, policy("vendor/bin:$PATH").whole], [
    true,
    false,
  ]);
  const server = (PATH: string) =>
    commandPaths(
      ".codex/config.toml",
      enc(`[mcp_servers.s]\ncommand = "serve"\n[mcp_servers.s.env]\nPATH = "${PATH}"\n`),
      none,
    );
  assertEquals([server("srv/bin").whole, server("srv/bin:$PATH").whole], [true, false]);
});

Deno.test("a key `PATH` in an object no table row names is read as documenting nothing", () => {
  const found = commandPaths(".codex/hooks.json", json({ x: { PATH: "./bin:$PATH" } }), none);
  assertEquals(found.whole, false);
  // Another object's key in another letter case is not surely PATH: it is only looked up.
  assertEquals(
    commandPaths(".claude/settings.json", json({ x: { Path: "a:$P" } }), none).whole,
    true,
  );
});

Deno.test("a PATH a shell sets is read as a shell expands it, and as written too", () => {
  const span = commandPaths(".claude/commands/c.md", enc("Run !`PATH=./bin:$PATH lint`\n"), none);
  assertEquals([span.whole, sorted(span.onPath)], [true, ["$PATH", "bin"]]);
  // A hook in exec form runs with no shell: `$PATH` in its `args` is a folder so named.
  const hook = { type: "command", command: "env", args: ["PATH=./bin:$PATH", "lint"] };
  const exec = json({ hooks: { Stop: [{ hooks: [hook] }] } });
  const found = commandPaths(".claude/settings.json", exec, none);
  assertEquals(sorted(found.onPath), ["$PATH", "bin"]);
});
