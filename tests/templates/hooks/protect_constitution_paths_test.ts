import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { type Harness, payload, pool, runHook, sandbox } from "./hook_sandbox.ts";
import { C, HOOK, project, verdict } from "./constitution_fixture.ts";

/**
 * Spec 038 US4, review of cli#684: every spelling of `docs/constitution.md`
 * an Edit, NotebookEdit or apply_patch payload can carry is the constitution —
 * through a link, in another case (a case-insensitive filesystem opens the
 * same file), through `..`, and as a patch's `*** Move to:` or
 * `*** Delete File:`. Without a stamp, each is denied.
 */

const WINDOWS = Deno.build.os === "windows";

const edit = (repo: string, tool: "Edit" | "NotebookEdit", file: string) =>
  payload("claude", "pre_tool_use_edit", {
    cwd: join(repo, "src"),
    tool_name: tool,
    tool_input: tool === "Edit"
      ? { file_path: file, old_string: "x", new_string: "y" }
      : { notebook_path: file, new_source: "y" },
  });

/** A patch run from `cwd` — relative headers resolve against it, as Codex does. */
const patch = (cwd: string, body: string) =>
  payload("codex", "pre_tool_use_apply_patch", {
    cwd,
    tool_input: { command: `*** Begin Patch\n${body}*** End Patch\n` },
  });

Deno.test("protect-constitution: every spelling of the constitution in an edit or patch is denied", async () => {
  const sb = await sandbox();
  try {
    const repo = await project(sb);
    const spellings = [
      ...(WINDOWS ? [] : [join(repo, "rules-link")]), // a symlink to it
      join(repo, "DOCS", "Constitution.MD"), // a case variant
      "../docs/constitution.md", // `..` from src/
      join(repo, "src", "..", "docs", "./constitution.md"),
    ];
    const cases: [string, Harness, Promise<Record<string, unknown>>][] = [
      ...spellings.flatMap((f): [string, Harness, Promise<Record<string, unknown>>][] => [
        [`Edit ${f}`, "claude", edit(repo, "Edit", f)],
        [`NotebookEdit ${f}`, "claude", edit(repo, "NotebookEdit", f)],
        [`patch Update ${f}`, "codex", patch(join(repo, "src"), `*** Update File: ${f}\n`)],
      ]),
      ["patch Move to", "codex", patch(repo, `*** Update File: src/a.ts\n*** Move to: ${C}\n`)],
      [
        "patch Move to, cased",
        "codex",
        patch(repo, "*** Update File: src/a.ts\n*** Move to: Docs/CONSTITUTION.md\n"),
      ],
      ["patch Move from", "codex", patch(repo, `*** Update File: ${C}\n*** Move to: src/c.md\n`)],
      ["patch Delete File", "codex", patch(repo, `*** Delete File: ${C}\n`)],
      [
        "patch Delete File, ..",
        "codex",
        patch(repo, "*** Delete File: src/../docs/constitution.md\n"),
      ],
    ];
    const wrong = (await pool(cases, async ([what, h, p]) => {
      const got = verdict(await runHook(sb, HOOK, h, await p));
      return got === "deny" ? "" : `${what}: want deny, got ${got}`;
    })).filter((x) => x !== "");
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});
