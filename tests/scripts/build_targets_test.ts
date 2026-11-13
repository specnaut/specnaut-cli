import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { TARGETS } from "../../scripts/build.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

/**
 * The release target table, which release.yml reads through `--list-json` rather than keeping a
 * second list (the asset names drifted once that way, cli#595). It filters the macOS binaries it
 * signs on `goos`, and runs each one's smoke test on `runner`, so both are pinned here.
 */

Deno.test("every release target names its OS family, and the set is the five", () => {
  assertEquals(
    TARGETS.map((t) => `${t.goos}=${t.outName}`),
    [
      "darwin=specnaut-macos-x64",
      "darwin=specnaut-macos-arm64",
      "linux=specnaut-linux-x64",
      "linux=specnaut-linux-arm64",
      "windows=specnaut-windows-x64.exe",
    ],
  );
});

Deno.test("each target names the native runner that executes it", () => {
  assertEquals(
    TARGETS.map((t) => `${t.outName}@${t.runner}`),
    [
      "specnaut-macos-x64@macos-15-intel",
      "specnaut-macos-arm64@macos-latest",
      "specnaut-linux-x64@ubuntu-latest",
      "specnaut-linux-arm64@ubuntu-24.04-arm",
      "specnaut-windows-x64.exe@windows-latest",
    ],
  );
});

Deno.test("--list-json prints the target table and nothing else", async () => {
  const { code, stdout } = await new Deno.Command("deno", {
    args: ["run", `${ROOT}scripts/build.ts`, "--list-json"],
    stdout: "piped",
    stderr: "null",
  }).output();
  assertEquals(code, 0);
  assertEquals(JSON.parse(new TextDecoder().decode(stdout)), TARGETS);
});
