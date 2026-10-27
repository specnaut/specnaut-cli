import { assertEquals } from "@std/assert";
import { goBuildCommand, TARGETS } from "../../scripts/build.ts";

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
