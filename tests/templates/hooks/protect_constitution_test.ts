import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  approve,
  type Harness,
  HARNESSES,
  makeRepo,
  payload,
  pool,
  runHook,
  sandbox,
} from "./hook_sandbox.ts";
import { C, HOOK, project, SELF, UI, verdict } from "./constitution_fixture.ts";

/**
 * Spec 038 US4 / FR-012 — an agent cannot amend `docs/constitution.md` or the
 * three gate configs on its own. Every write is denied unless the user's own
 * prompt this turn typed the phrase of that file's kind (S2): `constitution`
 * for the constitution and for the hooks that guard it, `gate-config` for the
 * configs. With it, Claude asks once more where it can; Codex allows. A click
 * on a permission prompt alone is never enough, so no stamp means deny even in
 * Claude's default mode.
 *
 * The Bash arm (S1) lets a bare read through and judges everything else that
 * names a guarded file, including through a glob, a `$`, a redirect, or an
 * opaque `-c` string. A commit message or a branch name that merely says
 * "constitution" is not a write and is not gated.
 */

type Shape = "claude-edit" | "claude-bash" | "codex-patch" | "codex-bash";
const SHAPES: readonly Shape[] = ["claude-edit", "claude-bash", "codex-patch", "codex-bash"];

/** The payload of `shape` writing `file`, in session `session`. */
function write(shape: Shape, repo: string, file: string, session: string, mode = "default") {
  const common = { cwd: repo, session_id: session, permission_mode: mode };
  switch (shape) {
    case "claude-edit":
      return payload("claude", "pre_tool_use_edit", {
        ...common,
        tool_input: { file_path: join(repo, file), old_string: "x", new_string: "y" },
      });
    case "codex-patch":
      return payload("codex", "pre_tool_use_apply_patch", {
        ...common,
        tool_input: { command: `*** Begin Patch\n*** Update File: ${file}\n*** End Patch\n` },
      });
    default:
      return payload(shape === "claude-bash" ? "claude" : "codex", "pre_tool_use_bash", {
        ...common,
        tool_input: { command: `cp src/a.ts ${file}` },
      });
  }
}

const harnessOf = (s: Shape): Harness => s.startsWith("claude") ? "claude" : "codex";

Deno.test("protect-constitution: 4 input shapes × the stamp of each kind", async () => {
  const sb = await sandbox();
  try {
    const repo = await project(sb);
    const stamps = ["none", "constitution", "gate-config", "merge"] as const;
    const phrase: Record<string, string> = {
      constitution: "approve the constitution amendment",
      "gate-config": "approve the gate config change",
      merge: "merge",
    };
    for (const h of HARNESSES) {
      for (const s of stamps) {
        if (s !== "none") await approve(sb, h, repo, phrase[s], { session_id: `s-${s}` });
      }
    }
    // [file, the kind it needs | null]
    const targets: ReadonlyArray<[string, string | null]> = [
      [C, "constitution"],
      [UI, "gate-config"],
      [SELF, "constitution"],
      ["src/b.ts", null],
    ];
    const cases = SHAPES.flatMap((shape) =>
      targets.flatMap(([file, kind]) =>
        stamps.flatMap((s) =>
          [["default", shape, file, kind, s]].concat(
            shape.startsWith("claude") ? [["bypassPermissions", shape, file, kind, s]] : [],
          ) as [string, Shape, string, string | null, string][]
        )
      )
    );
    const wrong = (await pool(cases, async ([mode, shape, file, kind, s]) => {
      const want = kind === null
        ? "allow"
        : kind !== s
        ? "deny"
        : harnessOf(shape) === "claude" && mode === "default"
        ? "ask"
        : "allow";
      const p = await write(shape, repo, file, `s-${s}`, mode);
      const r = await runHook(sb, HOOK, harnessOf(shape), p);
      const got = verdict(r);
      return got === want ? "" : `${shape} ${mode} ${file} stamp ${s}: want ${want}, got ${got}`;
    })).filter((x) => x !== "");
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});

Deno.test("protect-constitution: a relative patch path creating the constitution from docs/", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto" });
    await Deno.mkdir(join(repo, "docs"));
    const p = await payload("codex", "pre_tool_use_apply_patch", {
      cwd: join(repo, "docs"),
      tool_input: {
        command: "*** Begin Patch\n*** Add File: Constitution.md\n+x\n*** End Patch\n",
      },
    });
    assertEquals(verdict(await runHook(sb, HOOK, "codex", p)), "deny");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("protect-constitution names the file, the kind, and the way through in its refusal", async () => {
  const sb = await sandbox();
  try {
    const repo = await project(sb);
    const deny = async (h: Harness, command: string) => {
      const p = await payload(h, "pre_tool_use_bash", { cwd: repo, tool_input: { command } });
      const r = await runHook(sb, HOOK, h, p);
      assertEquals(r.code, 2, r.stderr);
      return r.stderr;
    };
    for (const h of HARNESSES) {
      const c = await deny(h, `echo x > ${C}`);
      for (const want of [C, "constitution", 'plain "yes" does not approve it', "bare cat"]) {
        assertEquals(c.includes(want), true, `${h}: ${want} missing from: ${c}`);
      }
      assertEquals((await deny(h, `echo x > ${UI}`)).includes("gate config"), true);
      // One stamp holds one kind: a call touching both kinds cannot be approved at once.
      assertEquals(
        (await deny(h, `cp src/a.ts ${C} && cp src/a.ts ${UI}`)).includes("one at a time"),
        true,
      );
    }
  } finally {
    await sb.cleanup();
  }
});
