// cli#697: the local backend's task file has no labels field, so `add.sh`
// refuses a third positional argument instead of dropping it — a caller that
// passed labels must not believe they were recorded.
//
// The scripts sit three levels below a throwaway root, as the scaffold lays
// them out, so a regression that accepts the argument writes into the sandbox
// and never into the repository's own tree.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";

const LOCAL = "../../templates/core/skills/task/scripts/local";

async function sandbox(): Promise<{ root: string; add: string }> {
  const root = await Deno.makeTempDir({ prefix: "backlog-local-add-" });
  const scripts = join(root, ".specnaut", "scripts", "backlog");
  await Deno.mkdir(scripts, { recursive: true });
  for (const name of ["_config.sh", "add.sh", "render-index.sh"]) {
    await Deno.copyFile(
      fromFileUrl(new URL(`${LOCAL}/${name}`, import.meta.url)),
      join(scripts, name),
    );
  }
  // The shared files every backend installs beside its own: add.sh checks its title there.
  for (const name of ["_backlog_plan.sh", "_issue_text.sh"]) {
    await Deno.copyFile(
      fromFileUrl(new URL(`${LOCAL}/../${name}`, import.meta.url)),
      join(scripts, name),
    );
  }
  return { root, add: bashPath(join(scripts, "add.sh")) };
}

async function add(root: string, script: string, args: string[]) {
  const { code, stdout, stderr } = await new Deno.Command("bash", {
    args: [script, ...args],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { code, stdout: d.decode(stdout), stderr: d.decode(stderr) };
}

async function backlogFiles(root: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const e of Deno.readDir(join(root, ".specnaut", "backlog"))) names.push(e.name);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return names;
}

Deno.test("local add.sh: a labels argument is a usage error, and no task is written", async () => {
  const { root, add: script } = await sandbox();
  const r = await add(root, script, ["Fix the thing", "body", "bug,ui"]);
  assertEquals(r.code, 2, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, "labels");
  assertStringIncludes(r.stderr, 'usage: add.sh "<title>" [body] [--parent <num>]');
  assertEquals(await backlogFiles(root), []);
});

Deno.test("local add.sh: a labels argument after --parent is refused too", async () => {
  const { root, add: script } = await sandbox();
  const r = await add(root, script, ["Child", "body", "--parent", "1", "bug"]);
  assertEquals(r.code, 2, r.stdout + r.stderr);
  assertEquals(await backlogFiles(root), []);
});

Deno.test("local add.sh: title and body still create the task", async () => {
  const { root, add: script } = await sandbox();
  const r = await add(root, script, ["Fix the thing", "body"]);
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, "✓ created #001 — Fix the thing");
  const files = await backlogFiles(root);
  assert(files.includes("001-fix-the-thing.md"), files.join(", "));
});
