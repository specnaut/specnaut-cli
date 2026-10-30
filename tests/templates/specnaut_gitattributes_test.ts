// cli#701: the scaffolded `.specnaut/` tree ships a `.gitattributes` so a
// checkout under `core.autocrlf=true` (Git for Windows' default) writes LF.
// With CRLF, every bash script there fails under Git Bash on its first `\r`,
// and every managed file differs from its `installed.lock` hash.
//
// The repo is checked out under `core.autocrlf=true` on every runner — git
// converts on any platform when told to — so the case is red on macOS and
// Linux too without the file.

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const TEMPLATES = fromFileUrl(new URL("../../templates/", import.meta.url));
const ATTRIBUTES = join(TEMPLATES, "core/specnaut/.gitattributes");
const HOOK_ATTRIBUTES = join(TEMPLATES, "harness-specific/shared/hooks/.gitattributes");

async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
    env: {
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  }).output();
  const d = new TextDecoder();
  assertEquals(r.code, 0, `git ${args.join(" ")}: ${d.decode(r.stderr)}`);
  return d.decode(r.stdout);
}

/** Commits `files` with both attribute files installed, then checks them out again under autocrlf. */
async function checkoutUnderAutocrlf(files: Record<string, string>): Promise<string> {
  const repo = await Deno.makeTempDir({ prefix: "specnaut-gitattributes-" });
  await git(repo, "init", "-q");
  await git(repo, "config", "core.autocrlf", "false");
  await Deno.mkdir(join(repo, ".specnaut/hooks"), { recursive: true });
  await Deno.copyFile(ATTRIBUTES, join(repo, ".specnaut/.gitattributes"));
  await Deno.copyFile(HOOK_ATTRIBUTES, join(repo, ".specnaut/hooks/.gitattributes"));
  for (const [path, text] of Object.entries(files)) {
    await Deno.mkdir(join(repo, path, ".."), { recursive: true });
    await Deno.writeTextFile(join(repo, path), text);
  }
  await git(repo, "add", "-A");
  await git(repo, "commit", "-q", "-m", "init");
  await git(repo, "config", "core.autocrlf", "true");
  for (const path of Object.keys(files)) await Deno.remove(join(repo, path));
  await git(repo, "checkout", "--", ".");
  return repo;
}

Deno.test(".specnaut/ is checked out with LF under core.autocrlf=true", async () => {
  const repo = await checkoutUnderAutocrlf({
    ".specnaut/scripts/bash/common.sh": "#!/usr/bin/env bash\necho ok\n",
    ".specnaut/memory/size-limits.md": "# Size limits\n\nrules\n",
  });
  for (const path of [".specnaut/scripts/bash/common.sh", ".specnaut/memory/size-limits.md"]) {
    const text = await Deno.readTextFile(join(repo, path));
    assert(!text.includes("\r"), `${path} was checked out with CRLF`);
  }
});

Deno.test("a file saved with CRLF under .specnaut/ is committed with LF", async () => {
  const repo = await checkoutUnderAutocrlf({ ".specnaut/specs/001-x/plan.md": "# Plan\r\n" });
  const blob = await git(repo, "show", "HEAD:.specnaut/specs/001-x/plan.md");
  assertEquals(blob, "# Plan\n");
});

Deno.test("the hooks folder keeps its own byte-for-byte rule", async () => {
  const repo = await checkoutUnderAutocrlf({ ".specnaut/hooks/list.txt": "a\r\nb\n" });
  const text = await Deno.readTextFile(join(repo, ".specnaut/hooks/list.txt"));
  assertEquals(text, "a\r\nb\n");
});
