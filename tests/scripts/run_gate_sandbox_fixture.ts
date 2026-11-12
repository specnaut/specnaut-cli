import { assert, assertEquals } from "@std/assert";
import { DELIMITER, join } from "@std/path";
import { exportHead } from "./explicit_head_fixture.ts";
import { impactRepo } from "./gate_impact_fixture.ts";
import { tempDir } from "./run_gate_fixture.ts";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";

/**
 * The fixture of the `run-gate.sh --sandbox` tests: a project with a dirty work tree, a head
 * exported beside it, and a `specnaut` first on the PATH that records each call, writes its log and
 * exits as told, so no sandbox is needed. The project's commands write a mark when they run here.
 */

const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" '<end>' >>"$SANDBOX_CALLS"
while [ "$#" -gt 0 ]; do
  if [ "$1" = --log ]; then printf 'what the run printed\\n' >"$2"; fi
  shift
done
exit "$SANDBOX_RC"
`;

/** A project on `feature` with a dirty work tree, a head exported beside it, and a `specnaut`. */
export async function sandboxed(opts: Parameters<typeof impactRepo>[0] = {}) {
  const repo = await impactRepo(opts);
  const { head, objects } = await exportHead(repo.root, { "apps/web/a.ts": "the head's web\n" });
  await Deno.writeTextFile(join(repo.root, "apps/api/a.ts"), "an uncommitted edit\n");
  const bin = await tempDir("run-gate-bin-");
  await Deno.writeTextFile(join(bin, "specnaut"), STUB);
  if (Deno.build.os !== "windows") await Deno.chmod(join(bin, "specnaut"), 0o755);
  const evidence = bashPath(await tempDir("run-gate-review-"));
  const key = Object.keys(Deno.env.toObject()).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const calls = join(bin, "calls");
  const run = async (args: string[], rc = 0) => {
    await Deno.remove(calls).catch(() => undefined);
    const env = {
      [key]: `${bin}${DELIMITER}${Deno.env.get("PATH") ?? ""}`,
      SANDBOX_CALLS: bashPath(calls),
      SANDBOX_RC: String(rc),
    };
    const r = await repo.gate("bash", args, { env });
    const text = await Deno.readTextFile(calls).catch(() => "");
    const said = text.replaceAll("\r", "").split("<end>\n").filter(Boolean);
    return { ...r, calls: said.map((c) => c.split("\n").slice(0, -1)) };
  };
  const full = ["--head", head, "--objects", objects, "--evidence", evidence, "--sandbox"];
  return { repo, head, objects, evidence, run, full };
}

/** The one evidence file a run wrote under `folder`. */
export const evidenceOf = async (folder: string) => {
  const dir = join(folder, "specnaut/gate-evidence");
  const names = [...Deno.readDirSync(dir)].map((e) => e.name);
  assertEquals(names.length, 1, names.join(" "));
  assert(names[0].startsWith("fast-"), names[0]);
  return JSON.parse(await Deno.readTextFile(join(dir, names[0])));
};
