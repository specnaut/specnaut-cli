import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { BASH_SCRIPTS_DIR, bashPath, HOOKS_DIR } from "./hook_sandbox.ts";
import { CODEX_REGISTRATIONS } from "../../../scripts/gen-hooks.ts";
import { codexHookCommand } from "../../../src/domain/hook_command.ts";

/**
 * A Specnaut project with no .git of its own, inside another repository (a
 * workspace member). The guards used to take the git toplevel as the project:
 * the outer repository, so the inner lock went unprotected and every Codex
 * command looked for `.specnaut/hooks` in the wrong folder and refused every
 * tool call. The project is the folder the installed hooks sit in.
 */

async function nested(): Promise<{ outer: string; inner: string }> {
  const outer = await Deno.makeTempDir({ prefix: "nested-" });
  await new Deno.Command("git", { args: ["init", "-q"], cwd: outer }).output();
  const inner = join(outer, "packages", "app");
  await Deno.mkdir(join(inner, ".specnaut", "hooks"), { recursive: true });
  await Deno.mkdir(join(inner, ".specnaut", "scripts", "bash"), { recursive: true });
  await Deno.mkdir(join(inner, "src"), { recursive: true });
  for await (const e of Deno.readDir(HOOKS_DIR)) {
    if (e.isFile) {
      await Deno.copyFile(join(HOOKS_DIR, e.name), join(inner, ".specnaut", "hooks", e.name));
    }
  }
  for (const f of ["merge-mode.sh", "base-branch.sh"]) {
    await Deno.copyFile(join(BASH_SCRIPTS_DIR, f), join(inner, ".specnaut", "scripts", "bash", f));
  }
  await Deno.writeTextFile(join(inner, ".specnaut", "installed.lock"), "{}\n");
  return { outer, inner };
}

async function run(cmd: string, args: string[], cwd: string, payload: unknown) {
  const p = new Deno.Command(cmd, { args, cwd, stdin: "piped", stdout: "piped", stderr: "piped" })
    .spawn();
  const w = p.stdin.getWriter();
  await w.write(new TextEncoder().encode(JSON.stringify(payload)));
  await w.close();
  const out = await p.output();
  return { code: out.code, stderr: new TextDecoder().decode(out.stderr) };
}

const editLock = (inner: string) => ({
  session_id: "s1",
  turn_id: "t1",
  cwd: join(inner, "src"),
  hook_event_name: "PreToolUse",
  model: "m",
  permission_mode: "default",
  transcript_path: null,
  tool_name: "Edit",
  tool_use_id: "u1",
  tool_input: { file_path: join(inner, ".specnaut", "installed.lock") },
});

Deno.test("nested project: protect-generated guards the inner lock, not the outer repository's", async () => {
  const { outer, inner } = await nested();
  try {
    const hook = join(inner, ".specnaut", "hooks", "protect-generated.sh");
    const r = await run("bash", [bashPath(hook), "claude"], join(inner, "src"), editLock(inner));
    assertEquals(r.code, 2, r.stderr);
    // Refused as the lock: a guard that could not even start exits 2 as well.
    assertEquals(r.stderr.includes("is .specnaut/installed.lock"), true, r.stderr);
  } finally {
    await Deno.remove(outer, { recursive: true });
  }
});

Deno.test("nested project: a Codex command finds the inner .specnaut/hooks and runs the guard", async () => {
  const { outer, inner } = await nested();
  try {
    const sums = await Deno.readTextFile(join(HOOKS_DIR, "SHA256SUMS"));
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sums))),
    ).map((b) => b.toString(16).padStart(2, "0")).join("");
    const reg = CODEX_REGISTRATIONS.find((r) => r.script === "protect-generated.sh")!;
    const payload = {
      ...editLock(inner),
      tool_name: "apply_patch",
      tool_input: {
        command: `*** Begin Patch\n*** Update File: ${
          join(inner, ".specnaut", "installed.lock")
        }\n@@\n-{}\n+{"x":1}\n*** End Patch\n`,
      },
    };
    const r = await run("sh", ["-c", codexHookCommand(reg, hash)], join(inner, "src"), payload);
    assertEquals(r.code, 2);
    assertEquals(r.stderr.includes("changed since it was trusted"), false, r.stderr);
    assertEquals(r.stderr.includes("installed.lock"), true, r.stderr);
  } finally {
    await Deno.remove(outer, { recursive: true });
  }
});
