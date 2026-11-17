import { assertEquals } from "@std/assert";
import { targetWalk } from "../../src/application/head_targets.ts";
import { readCommands } from "../../src/application/instruction_commands.ts";
import type { BaseFile, GitObjectReader } from "../../src/application/script_trust_ports.ts";
import type { BaseEntry } from "../../src/domain/script_trust.ts";

/** Which of the files a command names the walk visits: those no other check judges. */

const enc = (s: string) => new TextEncoder().encode(s);
const BASE = { head: "H", tip: "T", mergeBase: "M" };

/** HEAD holds `paths` (a folder when it ends in `/`); the tip and the merge base hold nothing. */
function reader(paths: string[]): GitObjectReader {
  const files = paths.filter((p) => !p.endsWith("/"));
  const readFile = (commit: string, path: string): Promise<BaseFile> =>
    Promise.resolve(
      commit === "H" && files.includes(path)
        ? { kind: "blob", bytes: enc(path) }
        : { kind: "absent" },
    );
  const listed = paths.map((p) =>
    p.endsWith("/") ? { path: p.slice(0, -1), kind: "tree" } : { path: p, kind: "blob" }
  );
  const listPaths = (commit: string) => Promise.resolve(commit === "H" ? listed : []);
  return { projectPrefix: "", readFile, listPaths } as unknown as GitObjectReader;
}

const settings = (command: string): BaseEntry => ({
  kind: "blob",
  path: ".claude/settings.json",
  bytes: enc(JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } })),
});

Deno.test("a file the class judges, or a helper script, is not walked again", async () => {
  const held = [".claude/hooks/x.sh", "tools/", "tools/run.sh", ".specnaut/scripts/bash/y.sh"];
  const walk = targetWalk(reader(held), BASE);
  const command = "bash .claude/hooks/x.sh && tools/run.sh && .specnaut/scripts/bash/y.sh; echo hi";
  await readCommands(walk, { head: [settings(command)], tip: [] });
  assertEquals([...walk.files.keys()], ["tools/run.sh"]);
});

Deno.test("a word that names nothing HEAD or the tip holds visits nothing", async () => {
  const walk = targetWalk(reader(["tools/", "tools/run.sh"]), BASE);
  await readCommands(walk, { head: [settings("echo done > out.log; tools/gone.sh")], tip: [] });
  assertEquals([...walk.files.keys()], []);
});

Deno.test("a helper script's folder in another spelling is walked: the script check reads it as written", async () => {
  const walk = targetWalk(reader([".Specnaut/scripts/bash/y.sh"]), BASE);
  await readCommands(walk, { head: [settings("bash .Specnaut/scripts/bash/y.sh")], tip: [] });
  assertEquals([...walk.files.keys()], [".Specnaut/scripts/bash/y.sh"]);
});
