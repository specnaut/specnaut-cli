import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { commandPaths } from "../../src/domain/command_targets.ts";

/**
 * The reader of PowerShell's PATH checked against PowerShell's own parser, on a fixed corpus and on
 * each line varied at each token (a comment, a line's join, a backtick, a letter-case flip). The
 * oracle (`tests/fixtures/powershell_path/oracle.ps1`, its collector `writes.ps1`) runs nothing: it
 * parses each line and collects its PATH writes from the syntax tree, with the names, paths and
 * aliases PowerShell resolves. Each line holding one must be named as not fully read by the reader, or read with the
 * very folders PowerShell's constants put on PATH. `pwsh` runs with `-NoProfile -NonInteractive`,
 * and the corpus reaches it as a file named in its arguments, never inside a command.
 */

const FIXTURES = fromFileUrl(new URL("../fixtures/powershell_path/", import.meta.url));
/** How many lines of the corpus write PATH, as PowerShell's parser reads them. */
const WRITING_LINES = 70;

/**
 * A line or a variant of it: its corpus line, how it was varied (`base` for none), its text, its
 * parse errors, its PATH writes, and the folders they put on PATH when all are constants.
 */
type Line = {
  line: string;
  kind: "base" | "comment" | "join" | "backtick" | "case";
  text: string;
  errors: number;
  writes: number;
  folders: string[] | null;
};

const ENCODED = "JABlAG4AdgA6AFAAYQB0AGgAIAArAD0AIAAnADsAdABvAG8AbABzACcA";
/**
 * The corpus lines built of constants that the reader names, by design, rather than reads, each
 * with its reason. Every other such line, and its letter-case flips, must be read with PowerShell's
 * very folders: being named is no pass for a value the reader should read.
 */
const NAMED: ReadonlyMap<string, string> = new Map([
  ["$env:Path = 'tools', 'bin'", "a list PowerShell joins with blanks"],
  ["$env:Path = @('tools', 'bin') -join ';' + 'x'", "a separator built after the -join"],
  ['$env:Path = "tool`s;$env:Path"', "a string a backtick escapes"],
  ["$env:Path = 'to''ols'", "a string a doubled quote escapes"],
  ["pwsh -NoProfile -Command '$env:Path += '';tools''; lint'", "quotes a shell reads otherwise"],
  ...[
    "pwsh -NoProfile -EncodedCommand",
    "true;pwsh -e",
    "(pwsh -e",
    "p''wsh -e",
    "&pwsh -e",
  ].map((s) => [`${s} ${ENCODED}${s.startsWith("(") ? ")" : ""}`, "an encoded command"] as const),
]);

/**
 * Whether `pwsh` runs here. Off Windows and Linux CI, its absence skips the test loudly; on them
 * the test runs, and fails, since the check it makes is then never made at all.
 */
function pwshRuns(): boolean {
  try {
    const args = ["-NoProfile", "-NonInteractive", "-Command", "exit 0"];
    return new Deno.Command("pwsh", { args, stdout: "null", stderr: "null" }).outputSync().success;
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
    return false;
  }
}

const REQUIRED = Deno.build.os === "windows" ||
  (Deno.build.os === "linux" && Deno.env.get("CI") === "true");
const PWSH = pwshRuns();
if (!PWSH && !REQUIRED) {
  console.warn("WARN powershell_path_differential_test: pwsh is not on PATH, the test is SKIPPED");
}

async function oracle(): Promise<Line[]> {
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-File",
    `${FIXTURES}oracle.ps1`,
    `${FIXTURES}corpus.ps1`,
  ];
  const run = await new Deno.Command("pwsh", { args, stdout: "piped", stderr: "piped" }).output();
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  assert(run.success, `the oracle failed: ${decode(run.stderr)}`);
  return JSON.parse(decode(run.stdout));
}

const hook = (command: string) =>
  new TextEncoder().encode(
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } }),
  );

/**
 * Whether the reader holds what PowerShell does with `line`: every folder its constants put on PATH
 * on the reader's PATH. Not whole is enough for a variant spelled through a comment, a line's join
 * or a backtick, which the reader names by design, for a value not built of constants, and for a
 * line {@link NAMED} gives a reason for.
 */
function held(line: Line): boolean {
  const found = commandPaths(".claude/settings.json", hook(line.text), () => false);
  const read = line.folders !== null && line.folders.every((f) => found.onPath.includes(f));
  const plain = (line.kind === "base" || line.kind === "case") && !NAMED.has(line.line);
  return read || (!found.whole && (line.folders === null || !plain));
}

Deno.test({
  name: "every PATH write PowerShell parses in the corpus, and in each variant, is read or named",
  ignore: !PWSH && !REQUIRED,
  async fn() {
    assert(PWSH, "pwsh is required here: install PowerShell on this runner");
    const lines = await oracle();
    const base = lines.filter((l) => l.kind === "base");
    const named = base.filter((l) => NAMED.has(l.text));
    assertEquals(named.length, NAMED.size, "each named line is in the corpus");
    assertEquals(base.filter((l) => l.errors > 0).map((l) => l.text), []);
    assertEquals(base.filter((l) => l.writes > 0).length, WRITING_LINES);
    assert(lines.filter((l) => l.kind !== "base" && l.writes > 0).length > WRITING_LINES * 10);
    const missed = lines.filter((l) => l.errors === 0 && l.writes > 0 && !held(l));
    assertEquals(missed.map((l) => l.text), []);
  },
});

Deno.test({
  name:
    "the oracle takes only an unknown drive or provider as naming no item, and stops on any other failure",
  ignore: !PWSH && !REQUIRED,
  async fn() {
    assert(PWSH, "pwsh is required here: install PowerShell on this runner");
    const args = ["-NoProfile", "-NonInteractive", "-File", `${FIXTURES}rethrow_check.ps1`];
    const run = await new Deno.Command("pwsh", { args, stdout: "piped" }).output();
    assert(run.success);
    const outcome = JSON.parse(new TextDecoder().decode(run.stdout));
    assertEquals(outcome, { drive: "False", provider: "False", other: "stopped" });
  },
});
