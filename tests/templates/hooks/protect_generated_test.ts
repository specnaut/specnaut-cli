import { assertEquals } from "@std/assert";
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
 * the existing explanation), and the gate's own switches are held like a
 * landing: denied without this turn's `merge`, in Claude's ask modes too. Paths are decided by identity — resolved against the payload cwd,
 * `-ef` on the target or its deepest existing ancestor — so none of the
 * spellings the security seat reproduced (§ 11 F5) gets through: `//`, `./`,
 * `..`, case on a case-folding filesystem, a symlink, a path relative to a
 * subdirectory, indented and CRLF patch headers, `*** Move to:`.
 */

type Want = "allow" | "deny" | "gated";

/**
 * What only this hook's own rules print. A crash exits 2 too, so an exit code
 * alone would read a guard that never reached its rule as a deny (cli#711).
 */
const REFUSAL =
  /^specnaut protect-generated: (denied: .+ is \.specnaut\/installed\.lock\.|editing .+ changes how Specnaut gates landings)/;

function verdict(r: Run): string {
  if (r.code === 2 && REFUSAL.test(r.stderr)) return "deny";
  if (r.code === 0 && r.stdout === "") return "allow";
  if (r.code === 0 && JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision === "ask") {
    return "ask";
  }
  return `exit ${r.code}: ${r.stdout} ${r.stderr}`;
}

/**
 * What a gated path yields when nothing approved it: denied on both, in
 * Claude's default mode too — a click on an edit prompt is not the user's
 * typed `merge` (spec 048 § 8, guard-merge's one arm).
 */
const GATED: Record<Harness, string> = { claude: "deny", codex: "deny" };

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
    type Row = [string, string, string, string, Want];
    const L = ".specnaut/installed.lock";
    const SB = ".specnaut/scripts/bash";
    const cases: ReadonlyArray<Row> = [
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
      // What the landing guard runs, and the landing scripts with the hold they
      // run (spec 048 § 8): an edit could drop it.
      ...["merge-mode", "base-branch", "merge-hold", "land-feature", "remove-spec"].map((n) =>
        [n, repo, `${repo}/${SB}/${n}.sh`, `*** Update File: ${SB}/${n}.sh\n`, "gated"] as Row
      ),
      [
        "a sibling script",
        repo,
        `${repo}/${SB}/epic-status.sh`,
        `*** Update File: ${SB}/epic-status.sh\n`,
        "allow",
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

Deno.test("protect-generated: a gated switch goes through on this turn's merge approval", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "manual" });
    const edit = (h: Harness, file: string, extra: Record<string, unknown> = {}) =>
      payload(h, h === "codex" ? "pre_tool_use_apply_patch" : "pre_tool_use_edit", {
        cwd: repo,
        tool_input: h === "codex"
          ? { command: patch(`*** Update File: ${file}\n`) }
          : { file_path: `${repo}/${file}` },
        ...extra,
      });
    const files = [".specnaut/workflow.yml", ".specnaut/scripts/bash/merge-hold.sh"];
    // Claude's default mode is the one seat that can ask.
    const seats = ["codex default", "claude bypassPermissions", "claude default"];
    const judge = async (want: string[]) => {
      const got: string[] = [], expected: string[] = [];
      for (const file of files) {
        for (const [i, seat] of seats.entries()) {
          const [h, permission_mode] = seat.split(" ") as [Harness, string];
          const r = await runHook(
            sb,
            "protect-generated.sh",
            h,
            await edit(h, file, { permission_mode }),
          );
          got.push(`${seat} ${file}: ${verdict(r)}`);
          expected.push(`${seat} ${file}: ${want[i]}`);
        }
      }
      assertEquals(got, expected);
    };

    await judge(["deny", "deny", "deny"]);
    await approve(sb, "codex", repo, "merge");
    await approve(sb, "claude", repo, "merge");
    // With the typed `merge`, Claude's prompt once where it can ask.
    await judge(["allow", "allow", "ask"]);

    // The lock is never a gate: no approval opens it.
    const lock = await edit("codex", ".specnaut/installed.lock");
    assertEquals((await runHook(sb, "protect-generated.sh", "codex", lock)).code, 2);
  } finally {
    await sb.cleanup();
  }
});
