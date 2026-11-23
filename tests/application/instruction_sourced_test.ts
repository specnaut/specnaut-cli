import { assertEquals } from "@std/assert";
import { targetWalk } from "../../src/application/head_targets.ts";
import { readCommands } from "../../src/application/instruction_commands.ts";
import type { BaseFile, GitObjectReader } from "../../src/application/script_trust_ports.ts";
import type { BaseEntry } from "../../src/domain/script_trust.ts";

/**
 * A repository file a command runs in its own process is read, at HEAD and at the tip, for the
 * PATH it sets when every line of it is an assignment; any other names its source as not fully
 * read.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const BASE = { head: "H", tip: "T", mergeBase: "M" };
const PARTIAL = "commands not fully read";

/** Each commit's files by path (a link when its text starts with `@`), and HEAD's folders. */
function reader(at: Record<string, Record<string, string>>): GitObjectReader {
  const readFile = (commit: string, path: string): Promise<BaseFile> => {
    const text = at[commit]?.[path];
    if (text === undefined) return Promise.resolve({ kind: "absent" });
    if (text.startsWith("@")) return Promise.resolve({ kind: "not_regular" });
    return Promise.resolve({ kind: "blob", bytes: enc(text) });
  };
  const listPaths = (commit: string) =>
    Promise.resolve(
      Object.entries(at[commit] ?? {}).map(([path, text]) =>
        text.startsWith("@")
          ? { path, kind: "link", target: text.slice(1) }
          : { path, kind: "blob" }
      ),
    );
  return { projectPrefix: "", readFile, listPaths } as unknown as GitObjectReader;
}

const settings = (command: string): BaseEntry => ({
  kind: "blob",
  path: ".claude/settings.json",
  bytes: enc(JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } })),
});

/**
 * What the walk visits and the sources it names, for `env.sh` as each commit holds it, with
 * `real.sh` holding `X=1` beside it.
 */
async function walked(head: string | undefined, tip?: string, command = ". ./env.sh && lint") {
  const files = (text: string | undefined): Record<string, string> => ({
    "bin/lint": "x",
    "real.sh": "X=1",
    ...(text === undefined ? {} : { "env.sh": text }),
  });
  const walk = targetWalk(reader({ H: files(head), T: files(tip) }), BASE);
  await readCommands(walk, { head: [settings(command)], tip: [] });
  const named = walk.reasons.filter((r) => r.reason === PARTIAL).map((r) => r.path);
  return { visited: [...walk.files.keys()].sort(), named };
}

Deno.test("a sourced file that sets PATH puts its folders on PATH, at HEAD and at the tip", async () => {
  const found = await walked('export PATH="./bin:$PATH"', "# none yet");
  assertEquals(found, { visited: ["bin/lint", "env.sh"], named: [] });
  // The file the link below leads to is read whole on its own.
  assertEquals((await walked("X=1", "X=1", ". ./real.sh && lint")).named, []);
  // The tip's PATH is read too: a folder only it names is searched as well.
  assertEquals((await walked("X=1", "PATH=./bin:$PATH")).visited, [
    "bin/lint",
    "env.sh",
  ]);
});

Deno.test("a sourced file that sets no PATH leaves the reading whole and PATH as it was", async () => {
  const found = await walked("# env\nexport NODE_ENV=test\n");
  assertEquals(found, { visited: ["env.sh"], named: [] });
});

Deno.test("a sourced file that cannot be read whole names its source", async () => {
  const cases: [string, string | undefined, string | undefined, string?][] = [
    ["missing", undefined, undefined],
    ["outside the project", "X=1", "X=1", ". ../env.sh && lint"],
    ["a cycle", ". ./env.sh", ". ./env.sh"],
    ["a chain past the limit", "source ./more.sh", "source ./more.sh"],
    ["a command", "PATH=./bin:$PATH\nlint", "X=1"],
    ["the tip's lines", "X=1", "alias lint=./bin/lint"],
    ["a link to a file of assignments", "@real.sh", "@real.sh"],
    ["past the size cap", `X=${"a".repeat(70_000)}`, "X=1"],
  ];
  for (const [name, head, tip, command] of cases) {
    assertEquals((await walked(head, tip, command)).named, [".claude/settings.json"], name);
  }
});
