import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parseLock } from "../../src/domain/installed_lock.ts";

// Spec 020 / FR-010 — the backward-compatible upgrade path. A project whose lock
// predates this feature (no `spec_backend` key) must upgrade to `spec_backend:
// local` with the rendered `specify.md` byte-identical to before — a `local`
// project sees zero behaviour change. Driven through the real compiled CLI.

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));
const GOLDEN = fromFileUrl(new URL("../fixtures/specify_local_golden.md", import.meta.url));

async function runSpecnaut(
  args: string[],
  cwd: string,
): Promise<{ code: number; stderr: string }> {
  const { code, stderr } = await new Deno.Command("deno", {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code, stderr: new TextDecoder().decode(stderr) };
}

Deno.test("pre-feature lock → upgrade → spec_backend: local, specify.md unchanged", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-upgrade-spec-" });
  try {
    // 1. Init a real claude project on the local backend.
    const init = await runSpecnaut(
      [
        "init",
        "--here",
        "--no-git",
        "--ai",
        "claude",
        "--backlog",
        "local",
        "--spec-backend",
        "local",
      ],
      dir,
    );
    assertEquals(init.code, 0, `init failed: ${init.stderr}`);

    const lockPath = join(dir, ".specnaut/installed.lock");
    // 2. Simulate a pre-feature lock by stripping the spec_backend key.
    const stripped = (await Deno.readTextFile(lockPath))
      .split("\n")
      .filter((l) => !l.startsWith("spec_backend:"))
      .join("\n");
    await Deno.writeTextFile(lockPath, stripped);
    assertEquals(parseLock(stripped).specBackend, "local"); // absent → local (FR-010)

    // 3. Upgrade the project.
    const up = await runSpecnaut(["upgrade", "--force"], dir);
    assertEquals(up.code, 0, `upgrade failed: ${up.stderr}`);

    // 4. The lock now records spec_backend: local...
    const after = parseLock(await Deno.readTextFile(lockPath));
    assertEquals(after.specBackend, "local");

    // 5. ...and the rendered specify.md is byte-identical to the pre-feature output.
    const onDisk = await Deno.readTextFile(
      join(dir, ".claude/skills/specnaut/phases/specify.md"),
    );
    assertEquals(onDisk, await Deno.readTextFile(GOLDEN));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
