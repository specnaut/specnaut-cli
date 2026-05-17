import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { computeNextVersion, VERSIONED_FILES, writeVersions } from "../../scripts/bump-version.ts";

Deno.test("computeNextVersion patch bump", () => {
  assertEquals(computeNextVersion("0.1.0", "patch"), "0.1.1");
});

Deno.test("computeNextVersion minor bump resets patch", () => {
  assertEquals(computeNextVersion("0.1.5", "minor"), "0.2.0");
});

Deno.test("computeNextVersion major bump resets minor and patch", () => {
  assertEquals(computeNextVersion("1.4.7", "major"), "2.0.0");
});

Deno.test("computeNextVersion drops prerelease on any simple bump", () => {
  assertEquals(computeNextVersion("0.1.0-alpha.3", "patch"), "0.1.0");
});

Deno.test("computeNextVersion prerelease bump appends/increments suffix", () => {
  assertEquals(computeNextVersion("0.1.0", "prerelease:alpha"), "0.1.1-alpha.1");
  assertEquals(
    computeNextVersion("0.1.1-alpha.1", "prerelease:alpha"),
    "0.1.1-alpha.2",
  );
});

Deno.test("VERSIONED_FILES covers every file the release workflow gates on", () => {
  // If you add a file here, also add a guard for it to release.yml's
  // pre-flight step. Keep this list and the workflow in lockstep.
  assertEquals(
    VERSIONED_FILES,
    [
      "deno.json",
      "src/domain/version.ts",
      "plugin/.claude-plugin/plugin.json",
      "templates/manifest.json",
      ".codex-plugin/plugin.json",
    ] as const,
  );
});

Deno.test("writeVersions bumps every versioned file in lockstep", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "bump-version-test-" });
  try {
    // Lay out fixtures matching the real repo paths, all at version 1.2.3.
    await Deno.writeTextFile(
      join(tmp, "deno.json"),
      `{\n  "name": "@mkrlabs/specflow",\n  "version": "1.2.3"\n}\n`,
    );
    await Deno.mkdir(join(tmp, "src/domain"), { recursive: true });
    await Deno.writeTextFile(
      join(tmp, "src/domain/version.ts"),
      `export const VERSION = "1.2.3";\n`,
    );
    await Deno.mkdir(join(tmp, "plugin/.claude-plugin"), { recursive: true });
    await Deno.writeTextFile(
      join(tmp, "plugin/.claude-plugin/plugin.json"),
      `{\n  "name": "specflow-plugin",\n  "version": "1.2.3"\n}\n`,
    );
    await Deno.mkdir(join(tmp, "templates"), { recursive: true });
    await Deno.writeTextFile(
      join(tmp, "templates/manifest.json"),
      `{\n  "version": "1.2.3",\n  "core": []\n}\n`,
    );
    await Deno.mkdir(join(tmp, ".codex-plugin"), { recursive: true });
    await Deno.writeTextFile(
      join(tmp, ".codex-plugin/plugin.json"),
      `{\n  "name": "specflow",\n  "version": "1.2.3"\n}\n`,
    );

    await writeVersions("1.2.4", tmp);

    for (const f of VERSIONED_FILES) {
      const contents = await Deno.readTextFile(join(tmp, f));
      assertStringIncludes(
        contents,
        "1.2.4",
        `${f} should contain the bumped version`,
      );
      assertEquals(
        contents.includes("1.2.3"),
        false,
        `${f} should not still contain the old version`,
      );
    }
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
