import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { FsPluginDetector } from "../../src/infrastructure/fs_plugin_detector.ts";

async function withFakeHome(
  fill: (home: string) => Promise<void>,
  fn: (home: string) => Promise<void>,
) {
  const home = await Deno.makeTempDir({ prefix: "specflow-plugindet-" });
  try {
    await fill(home);
    await fn(home);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
}

Deno.test("FsPluginDetector returns true when ~/.claude/plugins/cache/<name>/ exists as a directory", async () => {
  await withFakeHome(
    async (home) => {
      await Deno.mkdir(
        join(home, ".claude/plugins/cache/claude-specflow"),
        { recursive: true },
      );
    },
    async (home) => {
      const det = new FsPluginDetector(home);
      assertEquals(await det.isPluginInstalled("claude-specflow"), true);
    },
  );
});

Deno.test("FsPluginDetector returns false when the cache dir is missing", async () => {
  await withFakeHome(
    async (_home) => {/* empty home */},
    async (home) => {
      const det = new FsPluginDetector(home);
      assertEquals(await det.isPluginInstalled("claude-specflow"), false);
    },
  );
});

Deno.test("FsPluginDetector returns false when a sibling plugin is installed but not the requested one", async () => {
  await withFakeHome(
    async (home) => {
      await Deno.mkdir(
        join(home, ".claude/plugins/cache/some-other-plugin"),
        { recursive: true },
      );
    },
    async (home) => {
      const det = new FsPluginDetector(home);
      assertEquals(await det.isPluginInstalled("claude-specflow"), false);
    },
  );
});

Deno.test("FsPluginDetector returns false when the cache path exists but is a file (not a dir)", async () => {
  await withFakeHome(
    async (home) => {
      await Deno.mkdir(join(home, ".claude/plugins/cache"), { recursive: true });
      await Deno.writeTextFile(
        join(home, ".claude/plugins/cache/claude-specflow"),
        "oops",
      );
    },
    async (home) => {
      const det = new FsPluginDetector(home);
      assertEquals(await det.isPluginInstalled("claude-specflow"), false);
    },
  );
});

Deno.test("FsPluginDetector returns false when HOME is not resolvable (null)", async () => {
  const det = new FsPluginDetector(null);
  assertEquals(await det.isPluginInstalled("claude-specflow"), false);
});

Deno.test("FsPluginDetector default constructor reads HOME from the environment", () => {
  // Just verify construction doesn't throw — the actual probe behavior
  // is exercised by the explicit-home tests above (which avoid touching
  // the real ~/.claude/plugins/cache/).
  const det = new FsPluginDetector();
  assertEquals(typeof det.isPluginInstalled, "function");
});
