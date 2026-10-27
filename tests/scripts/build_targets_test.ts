import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { goBuildCommand, TARGETS } from "../../scripts/build.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

/**
 * cli#662 — the Go port builds from the same target table as the release.
 *
 * A second list in the dry-run workflow is how the asset names would drift
 * (they drifted once, cli#595), so each entry carries its Go coordinates and
 * `build.ts --go` reads them. These pin what the issue asks for: the five
 * targets, cgo off, every output under dist/ with the current asset name.
 */

Deno.test("every release target names its Go platform, and the set is the five", () => {
  assertEquals(
    TARGETS.map((t) => `${t.goos}/${t.goarch}=${t.outName}`),
    [
      "darwin/amd64=specnaut-macos-x64",
      "darwin/arm64=specnaut-macos-arm64",
      "linux/amd64=specnaut-linux-x64",
      "linux/arm64=specnaut-linux-arm64",
      "windows/amd64=specnaut-windows-x64.exe",
    ],
  );
});

Deno.test("the Go build is cgo-free, trimmed, and writes the asset name under dist/", () => {
  for (const t of TARGETS) {
    const { args, env } = goBuildCommand(t);
    assertEquals(env, { CGO_ENABLED: "0", GOOS: t.goos, GOARCH: t.goarch });
    assertEquals(args, ["build", "-trimpath", "-o", `dist/${t.outName}`, "./cmd/specnaut"]);
  }
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

Deno.test("go-dry-run.yml names no asset: its matrix and asset list come from --list-json", async () => {
  const workflow = await Deno.readTextFile(`${ROOT}.github/workflows/go-dry-run.yml`);
  for (const t of TARGETS) {
    assert(
      !workflow.includes(t.outName),
      `go-dry-run.yml names ${t.outName}; read it from TARGETS`,
    );
  }
  assert(
    workflow.includes("scripts/build.ts --list-json"),
    "the dry run no longer reads the table",
  );
  assert(workflow.includes("fromJSON(needs.build.outputs.targets)"), "the matrix is not the table");
});
