import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, fromFileUrl } from "@std/path";
import { walk } from "@std/fs";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { phase } from "./task_docs.ts";

/**
 * The merge mode (spec 036): one file, one reader, and the phases that follow
 * it instead of always asking. Split out of `chain_stops_test.ts` (cli#709).
 */

Deno.test("review, merge and merge-close follow the merge mode instead of always asking", () => {
  const review = phase("review").content;
  assertStringIncludes(
    review,
    "under `auto` (the default) invoke `/task merge` in the same turn",
  );
  const merge = phase("merge").content;
  // The base branch has one home (spec 036); merge.md asks it and never assumes main.
  assertStringIncludes(merge, "bash .specnaut/scripts/bash/base-branch.sh");
  assertStringIncludes(merge, "never assume `main`");
  // D6: merge never asks about the push (run by land-feature.sh); D4: it does not read the mode.
  assertStringIncludes(merge, "pushes without asking, in either merge mode");
  assert(!merge.includes("workflow.yml"), "merge.md must not read the merge mode (one reader)");
  // D7: a rejected push is never forced; nothing closes until a landing pushes (cli#711).
  assertStringIncludes(merge, "quote the remote's message — never `--force`");
  assertStringIncludes(merge, "The close does not run until a landing pushes");
  // The multi-branch case lost its "no" answer; --no-close replaces it.
  assertStringIncludes(merge, "`--no-close`");
  const close = phase("merge-close").content;
  assertStringIncludes(close, "**Do not ask.** The push was the authorisation");
});

Deno.test("the router parses --manual-merge without making it a chain flag", () => {
  const router = CORE_BUNDLE.find((x) => x.category === "backlog-skill" && x.name === "task");
  if (!router) throw new Error("missing /task router");
  assertStringIncludes(router.content, "[--manual] [--manual-merge] <verb> [rest]");
  assertStringIncludes(router.content, "`--manual` is the only chain flag");
  assertStringIncludes(router.content, "It does not\n   stop the chain anywhere else.");
});

/**
 * The mode has one reader, `.specnaut/scripts/bash/merge-mode.sh` (FR-002):
 * auto-chain.md calls it and the landing hook calls it with `--strict`. The
 * phase doc used to carry its own `sed`; a second parser is how the two
 * askers would come to disagree, so the doc must name the script and carry no
 * parser, and the script must resolve every file shape (D3).
 */
Deno.test("auto-chain.md asks merge-mode.sh, and no template parses `merge:` itself (FR-002)", async () => {
  const content = phase("auto-chain").content;
  assertStringIncludes(content, "bash .specnaut/scripts/bash/merge-mode.sh");
  assert(!content.includes("sed -n"), "auto-chain.md must not carry its own merge-mode parser");
  const templates = new URL("../../templates/", import.meta.url);
  const parsers: string[] = [];
  for await (const e of walk(templates, { includeDirs: false })) {
    if (basename(e.path) === "merge-mode.sh") continue; // `\` on Windows, never `/`
    if ((await Deno.readTextFile(e.path)).includes("^merge:")) parsers.push(e.path);
  }
  assertEquals(parsers, [], "a second `^merge:` parser exists");
});

Deno.test("merge-mode.sh resolves every file shape the chain reads (D3)", async () => {
  const script = fromFileUrl(
    new URL("../../templates/core/specnaut/scripts/bash/merge-mode.sh", import.meta.url),
  );
  const cases: ReadonlyArray<[file: string | null, want: string, note?: string]> = [
    [null, "auto"],
    ["other: 1\n", "auto"],
    ["# merge: manual\n", "auto"],
    ["merge: auto\n", "auto"],
    ["merge: manual\n", "manual"],
    ["merge:manual  # a comment\n", "manual"],
    ["merge: manul\n", "manual", "unrecognised: manul"],
    // Saved on Windows, or checked out with core.autocrlf: the \r is no part of the value.
    ["merge: manual\r\n", "manual"],
    ["merge: auto\r\n", "auto"],
  ];
  for (const [file, want, note] of cases) {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${dir}/.specnaut`);
      if (file !== null) await Deno.writeTextFile(`${dir}/.specnaut/workflow.yml`, file);
      const out = await new Deno.Command("bash", { args: [script], cwd: dir }).output();
      const dec = new TextDecoder();
      assertEquals(dec.decode(out.stdout), `${want}\n`, `file: ${JSON.stringify(file)}`);
      if (note) assertStringIncludes(dec.decode(out.stderr), note);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});

Deno.test("workflow.yml ships with merge: auto as the scaffolded default", () => {
  const e = CORE_BUNDLE.find((x) => x.category === "spec-root" && x.suffix === "workflow.yml");
  if (!e) throw new Error("missing .specnaut/workflow.yml entry");
  assert(/^merge: auto$/m.test(e.content), "workflow.yml must default to `merge: auto`");
  assertStringIncludes(e.content, "merge: manual");
});
