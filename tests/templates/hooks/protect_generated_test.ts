import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  approve,
  type Harness,
  makeRepo,
  payload,
  pool,
  type Run,
  runHook,
  sandbox,
} from "./hook_sandbox.ts";

/**
 * US3 / FR-004 — `.specnaut/installed.lock` cannot be hand-edited (exit 2,
 * the existing explanation), and the gate's own switches are gated like a
 * merge. Paths are decided by identity — resolved against the payload cwd,
 * `-ef` on the target or its deepest existing ancestor — so none of the
 * spellings the security seat reproduced (§ 11 F5) gets through: `//`, `./`,
 * `..`, case on a case-folding filesystem, a symlink, a path relative to a
 * subdirectory, indented and CRLF patch headers, `*** Move to:`.
 */

type Want = "allow" | "deny" | "gated";

function verdict(r: Run): string {
  if (r.code === 2) return "deny";
  if (r.code === 0 && r.stdout === "") return "allow";
  if (r.code === 0 && JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision === "ask") {
    return "ask";
  }
  return `exit ${r.code}: ${r.stdout} ${r.stderr}`;
}

/** What a gated path yields when nothing approved it. */
const GATED: Record<Harness, string> = { claude: "ask", codex: "deny" };

const patch = (body: string) => `*** Begin Patch\n${body}*** End Patch\n`;

Deno.test("protect-generated: every spelling of the lock, and the gate's switches, on both harnesses", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto" });
    await Deno.writeTextFile(join(repo, ".specnaut", "installed.lock"), "version: 1\n");
    await Deno.mkdir(join(repo, ".specnaut", "hooks"));
    await Deno.writeTextFile(join(repo, ".specnaut", "hooks", "guard-merge.sh"), "#!/bin/sh\n");
    await Deno.mkdir(join(repo, "src"));
    await Deno.writeTextFile(join(repo, "src", "app.ts"), "export {};\n");
    await Deno.symlink(join(repo, ".specnaut", "installed.lock"), join(repo, "lock-link"));
    const noLock = await makeRepo(sb, { mode: "auto" });

    // [label, cwd, Claude file_path, Codex patch body, want]
    const L = ".specnaut/installed.lock";
    const cases: ReadonlyArray<[string, string, string, string, Want]> = [
      ["the lock", repo, `${repo}/${L}`, `*** Update File: ${L}\n@@\n-a\n+b\n`, "deny"],
      [
        "// inside",
        repo,
        `${repo}//.specnaut//installed.lock`,
        `*** Update File: .specnaut//installed.lock\n`,
        "deny",
      ],
      [
        "./ inside",
        repo,
        `${repo}/./.specnaut/./installed.lock`,
        `*** Update File: ./${L}\n`,
        "deny",
      ],
      // POSIX only: on Windows `/${repo}` is `/C:\…`, a shape no harness sends.
      ...(Deno.build.os === "windows" ? [] : [
        ["absolute //", repo, `/${repo}/${L}`, `*** Update File: /${repo}/${L}\n`, "deny" as Want],
      ] as [string, string, string, string, Want][]),
      ["..", repo, `${repo}/src/../${L}`, `*** Update File: src/../${L}\n`, "deny"],
      [
        "case",
        repo,
        `${repo}/.SPECNAUT/Installed.Lock`,
        `*** Update File: .Specnaut/INSTALLED.lock\n`,
        "deny",
      ],
      ["a symlink to it", repo, `${repo}/lock-link`, `*** Update File: lock-link\n`, "deny"],
      [
        "from a subdirectory",
        join(repo, "src"),
        `${repo}/${L}`,
        `*** Update File: ../${L}\n`,
        "deny",
      ],
      ["indented header", repo, `${repo}/${L}`, `   *** Update File: ${L}\n`, "deny"],
      ["CRLF header", repo, `${repo}/${L}`, `*** Update File: ${L}\r\n@@\r\n`, "deny"],
      ["Move to", repo, `${repo}/${L}`, `*** Update File: src/app.ts\n*** Move to: ${L}\n`, "deny"],
      ["Delete", repo, `${repo}/${L}`, `*** Delete File: ${L}\n`, "deny"],
      ["Add, lock absent", noLock, `${noLock}/${L}`, `*** Add File: ${L}\n+x\n`, "deny"],
      [
        "workflow.yml",
        repo,
        `${repo}/.specnaut/workflow.yml`,
        `*** Update File: .specnaut/workflow.yml\n`,
        "gated",
      ],
      [
        "a hook",
        repo,
        `${repo}/.specnaut/hooks/guard-merge.sh`,
        `*** Update File: .specnaut/hooks/guard-merge.sh\n`,
        "gated",
      ],
      [
        "a new hook",
        repo,
        `${repo}/.specnaut/hooks/new.sh`,
        `*** Add File: .specnaut/hooks/new.sh\n`,
        "gated",
      ],
      [
        "hooks.json",
        repo,
        `${repo}/.codex/hooks.json`,
        `*** Add File: .codex/hooks.json\n`,
        "gated",
      ],
      [
        "settings.json",
        repo,
        `${repo}/.claude/settings.json`,
        `*** Add File: .claude/settings.json\n`,
        "gated",
      ],
      [
        "settings.local.json",
        repo,
        `${repo}/.claude/settings.local.json`,
        `*** Add File: .claude/settings.local.json\n`,
        "gated",
      ],
      [
        "merge-mode.sh",
        repo,
        `${repo}/.specnaut/scripts/bash/merge-mode.sh`,
        `*** Update File: .specnaut/scripts/bash/merge-mode.sh\n`,
        "gated",
      ],
      [
        "base-branch.sh",
        repo,
        `${repo}/.specnaut/scripts/bash/base-branch.sh`,
        `*** Update File: .specnaut/scripts/bash/base-branch.sh\n`,
        "gated",
      ],
      ["an ordinary file", repo, `${repo}/src/app.ts`, `*** Update File: src/app.ts\n`, "allow"],
      [
        "a sibling of the lock",
        repo,
        `${repo}/.specnaut/installed.lock.bak`,
        `*** Add File: .specnaut/installed.lock.bak\n`,
        "allow",
      ],
      [
        "outside the project",
        repo,
        `/elsewhere/${L}`,
        `*** Update File: /elsewhere/${L}\n`,
        "allow",
      ],
    ];
    const runs = await pool(
      cases.flatMap(([label, cwd, file, body, want]) =>
        [
          [
            "claude",
            label,
            want,
            payload("claude", "pre_tool_use_edit", { cwd, tool_input: { file_path: file } }),
          ],
          [
            "codex",
            label,
            want,
            payload("codex", "pre_tool_use_apply_patch", {
              cwd,
              tool_input: { command: patch(body) },
            }),
          ],
        ] as const
      ),
      async ([harness, label, want, p]) => {
        const r = await runHook(sb, "protect-generated.sh", harness, await p);
        const expected = want === "gated" ? GATED[harness] : want;
        const v = verdict(r);
        return v === expected ? "" : `${harness} ${label}: want ${expected}, got ${v} ${r.stderr}`;
      },
    );
    const wrong = runs.filter((x) => x !== "");
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});

Deno.test("protect-generated keeps the lock's explanation, and refuses what it cannot read", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto" });
    const lock = await runHook(
      sb,
      "protect-generated.sh",
      "claude",
      await payload("claude", "pre_tool_use_edit", {
        cwd: repo,
        tool_input: { file_path: `${repo}/.specnaut/installed.lock` },
      }),
    );
    assertEquals(lock.code, 2);
    assertStringIncludes(lock.stderr, "installed.lock is generated by `specnaut init`");
    assertStringIncludes(lock.stderr, "re-run");

    const unreadable: Array<[Harness, Record<string, unknown>]> = [
      ["codex", { tool_input: { command: "*** Begin Patch\n@@\n-a\n+b\n*** End Patch\n" } }],
      ["codex", { tool_input: { command: "" } }],
      ["codex", { tool_input: { command: 42 } }],
      ["claude", { tool_input: { old_string: "a" } }],
      ["claude", { tool_name: "Bash", tool_input: { command: "ls" } }],
    ];
    for (const [harness, extra] of unreadable) {
      const name = harness === "claude" ? "pre_tool_use_edit" : "pre_tool_use_apply_patch";
      const r = await runHook(
        sb,
        "protect-generated.sh",
        harness,
        await payload(harness, name, { cwd: repo, ...extra }),
      );
      assertEquals(r.code, 2, `${harness} ${JSON.stringify(extra)}: ${r.stderr}`);
    }
  } finally {
    await sb.cleanup();
  }
});

Deno.test("protect-generated: a gated switch goes through on this turn's merge approval", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto" });
    const wf = (h: Harness, extra: Record<string, unknown> = {}) =>
      h === "codex"
        ? payload("codex", "pre_tool_use_apply_patch", {
          cwd: repo,
          tool_input: { command: patch("*** Update File: .specnaut/workflow.yml\n") },
          ...extra,
        })
        : payload("claude", "pre_tool_use_edit", {
          cwd: repo,
          tool_input: { file_path: `${repo}/.specnaut/workflow.yml` },
          ...extra,
        });
    assertEquals((await runHook(sb, "protect-generated.sh", "codex", await wf("codex"))).code, 2);
    const bypass = { permission_mode: "bypassPermissions" };
    assertEquals(
      (await runHook(sb, "protect-generated.sh", "claude", await wf("claude", bypass))).code,
      2,
    );

    await approve(sb, "codex", repo, "merge");
    await approve(sb, "claude", repo, "merge");
    assertEquals(
      verdict(await runHook(sb, "protect-generated.sh", "codex", await wf("codex"))),
      "allow",
    );
    assertEquals(
      verdict(await runHook(sb, "protect-generated.sh", "claude", await wf("claude", bypass))),
      "allow",
    );
    // The lock is never a gate: no approval opens it.
    const lock = await payload("codex", "pre_tool_use_apply_patch", {
      cwd: repo,
      tool_input: { command: patch("*** Update File: .specnaut/installed.lock\n") },
    });
    assertEquals((await runHook(sb, "protect-generated.sh", "codex", lock)).code, 2);
  } finally {
    await sb.cleanup();
  }
});
