import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { CODEX_REGISTRATIONS, generate, readIfPresent } from "../../scripts/gen-hooks.ts";
import { codexHookCommand as codexCommand } from "../../src/domain/hook_command.ts";
import { specnautHookFile } from "../../src/domain/hook_settings_merge.ts";

/**
 * The Codex registrations pin the hook folder's hash (spec 036, plan § 11
 * Measured: Codex trusts the definition, never the script). Three things must
 * hold for that to be worth anything: the committed files are what the
 * generator makes, the merge recognises every command as Specnaut's, and a
 * changed folder is refused rather than run.
 */

Deno.test("gen-hooks: the committed _agents.txt, SHA256SUMS and Codex hooks.json are current", async () => {
  const stale: string[] = [];
  for (const [path, content] of await generate()) {
    if (await readIfPresent(path) !== content) stale.push(path);
  }
  assertEquals(stale, [], "run `deno task bundle`");
});

Deno.test("gen-hooks: a generated file not yet written reads as absent; any other read error throws", async () => {
  const dir = await Deno.makeTempDir({ prefix: "gen-hooks-read-" });
  try {
    assertEquals(await readIfPresent(join(dir, "absent.json")), null);
    // A directory where the file should be is not "absent": swallowing it would
    // have the generator try to write over it, or --check call it merely stale.
    await assertRejects(() => readIfPresent(dir));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("gen-hooks: the merge recognises every Codex command as the script it runs", () => {
  for (const r of CODEX_REGISTRATIONS) {
    assertEquals(specnautHookFile(codexCommand(r, "0".repeat(64))), r.script.replace(/\.sh$/, ""));
  }
});

async function run(command: string, cwd: string): Promise<{ code: number; stderr: string }> {
  const p = new Deno.Command("sh", {
    args: ["-c", command],
    cwd,
    stdin: "piped",
    stderr: "piped",
    stdout: "null",
  })
    .spawn();
  const w = p.stdin.getWriter();
  await w.write(new TextEncoder().encode("{}"));
  await w.close();
  const out = await p.output();
  return { code: out.code, stderr: new TextDecoder().decode(out.stderr) };
}

Deno.test("gen-hooks: a Codex command runs an intact folder and refuses a changed one", async () => {
  const repo = await Deno.makeTempDir({ prefix: "gen-hooks-" });
  try {
    await new Deno.Command("git", { args: ["init", "-q"], cwd: repo }).output();
    const hooks = join(repo, ".specnaut", "hooks");
    await Deno.mkdir(hooks, { recursive: true });
    await Deno.mkdir(join(repo, "sub"));
    await Deno.writeTextFile(join(hooks, "probe.sh"), "echo ran >&2; exit 0\n");
    const sums = await sumsOf(hooks, ["probe.sh"]);
    await Deno.writeTextFile(join(hooks, "SHA256SUMS"), sums);
    const guard = codexCommand(
      { script: "probe.sh", args: "codex", onChanged: 2 },
      await hex(new TextEncoder().encode(sums)),
    );

    const intact = await run(guard, join(repo, "sub"));
    assertEquals([intact.code, intact.stderr.trim()], [0, "ran"]);

    await Deno.writeTextFile(join(hooks, "probe.sh"), "echo ran >&2; exit 0\n# edited\n");
    const changed = await run(guard, join(repo, "sub"));
    assertEquals(changed.code, 2);
    assertEquals(changed.stderr.includes("run specnaut upgrade"), true);
    assertEquals(changed.stderr.includes("ran"), false, "a changed folder runs nothing");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("gen-hooks: a project without SHA256SUMS refuses rather than run an outer project's hooks", async () => {
  // A project nested in another one: the outer is intact, the inner's
  // `.specnaut/hooks/` lost its SHA256SUMS. The walk must stop at the inner
  // folder and refuse — never climb to the outer and run ITS scripts here.
  const outer = await Deno.makeTempDir({ prefix: "gen-hooks-nested-" });
  try {
    const outerHooks = join(outer, ".specnaut", "hooks");
    const inner = join(outer, "packages", "inner");
    await Deno.mkdir(outerHooks, { recursive: true });
    await Deno.mkdir(join(inner, ".specnaut", "hooks"), { recursive: true });
    await Deno.writeTextFile(join(outerHooks, "probe.sh"), "echo RAN-OUTER >&2; exit 0\n");
    await Deno.writeTextFile(join(inner, ".specnaut", "hooks", "probe.sh"), "echo RAN-INNER >&2\n");
    const sums = await sumsOf(outerHooks, ["probe.sh"]);
    await Deno.writeTextFile(join(outerHooks, "SHA256SUMS"), sums);
    const guard = codexCommand(
      { script: "probe.sh", args: "codex", onChanged: 2 },
      await hex(new TextEncoder().encode(sums)),
    );

    const own = await run(guard, outer);
    assertEquals([own.code, own.stderr.trim()], [0, "RAN-OUTER"], "the outer runs its own hooks");
    const nested = await run(guard, inner);
    assertEquals(nested.code, 2);
    assertEquals(nested.stderr.includes("run specnaut upgrade"), true);
    assertEquals(nested.stderr.includes("RAN-"), false, `ran a script: ${nested.stderr}`);
  } finally {
    await Deno.remove(outer, { recursive: true });
  }
});

async function hex(bytes: BufferSource): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sumsOf(dir: string, names: string[]): Promise<string> {
  const lines = [];
  for (const n of names) lines.push(`${await hex(await Deno.readFile(join(dir, n)))}  ${n}`);
  return lines.join("\n") + "\n";
}
