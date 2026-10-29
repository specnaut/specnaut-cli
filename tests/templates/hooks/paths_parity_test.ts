import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  BOUNDARIES_CONFIG_PATH,
  CONSTITUTION_PATH,
  GATE_CONFIG_PATHS,
  LEGACY_CONSTITUTION_PATH,
  SIZE_LIMITS_CONFIG_PATH,
} from "../../../src/domain/constitution_paths.ts";
import { bashPath, HOOKS_DIR } from "./hook_sandbox.ts";

/**
 * Spec 038 (A-M3): the guarded paths have two homes, one per runtime — the
 * TypeScript module the binary reads and `_paths.sh` the hooks source. Neither
 * may drift from the other, so the bash list is read by sourcing the real
 * helper, never by parsing its text.
 */

async function bashLists(): Promise<{ constitution: string; configs: string[] }> {
  const script = `. "${bashPath(join(HOOKS_DIR, "_paths.sh"))}"\n` +
    `printf '%s\\n' "$PATHS_CONSTITUTION"\nprintf '%s\\n' "\${PATHS_GATE_CONFIGS[@]}"\n`;
  const { code, stdout, stderr } = await new Deno.Command("bash", {
    args: ["-c", script],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const err = new TextDecoder().decode(stderr);
  assertEquals(code, 0, `sourcing _paths.sh failed: ${err}`);
  const [constitution, ...configs] = new TextDecoder().decode(stdout).replaceAll("\r", "")
    .split("\n").filter((l) => l !== "");
  return { constitution, configs };
}

Deno.test("the hooks guard the same constitution path the binary writes", async () => {
  assertEquals((await bashLists()).constitution, CONSTITUTION_PATH);
});

Deno.test("the hooks guard the same gate configs, in the same order, as the binary reads", async () => {
  assertEquals((await bashLists()).configs, [...GATE_CONFIG_PATHS]);
});

Deno.test("the constitution moves out of the framework tree into the project's docs", () => {
  assertEquals(CONSTITUTION_PATH, "docs/constitution.md");
  assertEquals(LEGACY_CONSTITUTION_PATH, ".specnaut/memory/constitution.md");
  assertEquals(GATE_CONFIG_PATHS, [
    ".specnaut/size-limits.yml",
    ".specnaut/boundaries.yml",
    ".specnaut/ui.yml",
  ]);
});

/**
 * The gate scripts (`size-ratchet.sh`, `boundary-check.sh`) ship to every
 * harness, the hooks only to two, so the gates take their paths from
 * `_config.sh` beside them — a third home, held to the same TypeScript one.
 */
Deno.test("the gate scripts read the same paths the binary writes and the hooks guard", async () => {
  const configSh = fromFileUrl(
    new URL("../../../templates/core/specnaut/scripts/bash/_config.sh", import.meta.url),
  );
  const { code, stdout } = await new Deno.Command("bash", {
    args: [
      "-c",
      '. "$1"; printf "%s\\n" "$CONFIG_CONSTITUTION" "$CONFIG_SIZE_LIMITS" "$CONFIG_BOUNDARIES"',
      "_",
      bashPath(configSh),
    ],
    stdout: "piped",
  }).output();
  assertEquals(code, 0);
  assertEquals(
    new TextDecoder().decode(stdout).replaceAll("\r", "").trim().split("\n"),
    [CONSTITUTION_PATH, SIZE_LIMITS_CONFIG_PATH, BOUNDARIES_CONFIG_PATH],
  );
});
