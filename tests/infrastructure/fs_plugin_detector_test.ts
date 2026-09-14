import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { FsPluginDetector } from "../../src/infrastructure/fs_plugin_detector.ts";

/**
 * cli#606 — the detector must answer about the filesystem Claude Code actually
 * writes, not the one the detector assumed.
 *
 * The previous version of this file built its fixture by creating
 * `cache/specnaut-plugin/` — the exact layout the implementation probed. It
 * could only ever confirm the implementation against itself, and it passed
 * throughout the entire period in which `isPluginInstalled` returned `false`
 * for every real installation and the binary → plugin migration never once
 * fired.
 *
 * So every fixture here is built the way Claude Code lays the cache out:
 *
 *     ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/
 *
 * with `~/.claude/plugins/installed_plugins.json` as the registry, keyed
 * `<plugin>@<marketplace>` and carrying an explicit `installPath`.
 *
 * The sharpest test is `a marketplace sharing the plugin's name is not the
 * plugin`: it is the false positive the old layout assumption produced, and it
 * is the one assertion that fails loudly against the old implementation rather
 * than quietly.
 */

type Install = { marketplace: string; plugin: string; version: string };

async function withFakeHome(
  fill: (home: string) => Promise<void>,
  fn: (home: string) => Promise<void>,
) {
  const home = await Deno.makeTempDir({ prefix: "specnaut-plugindet-" });
  try {
    await fill(home);
    await fn(home);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
}

/** Lays out a real-shaped install, registry included, and returns its root. */
async function install(home: string, i: Install, files: string[] = []): Promise<string> {
  const root = join(home, ".claude/plugins/cache", i.marketplace, i.plugin, i.version);
  await Deno.mkdir(root, { recursive: true });
  for (const f of files) {
    const p = join(root, f);
    await Deno.mkdir(join(p, ".."), { recursive: true });
    await Deno.writeTextFile(p, "stub");
  }
  await writeRegistry(home, [{ ...i, installPath: root }]);
  return root;
}

async function writeRegistry(
  home: string,
  entries: (Install & { installPath: string })[],
): Promise<void> {
  const plugins: Record<string, unknown[]> = {};
  for (const e of entries) {
    plugins[`${e.plugin}@${e.marketplace}`] = [
      { scope: "user", installPath: e.installPath, version: e.version },
    ];
  }
  await Deno.mkdir(join(home, ".claude/plugins"), { recursive: true });
  await Deno.writeTextFile(
    join(home, ".claude/plugins/installed_plugins.json"),
    JSON.stringify({ version: 2, plugins }, null, 2),
  );
}

Deno.test("a plugin installed in the real marketplace/plugin/version layout is detected", async () => {
  await withFakeHome(
    async (home) => {
      await install(home, {
        marketplace: "specnaut-marketplace",
        plugin: "specnaut-plugin",
        version: "4.3.0",
      });
    },
    async (home) => {
      const det = new FsPluginDetector(home);
      assertEquals(
        await det.isPluginInstalled("specnaut-plugin"),
        true,
        "the detector missed a real installation — this is cli#606: with this " +
          "false, `covered` in computeUpgradePlan is permanently false and the " +
          "whole binary → plugin migration is dead code",
      );
    },
  );
});

Deno.test("a marketplace sharing the plugin's name is not the plugin", async () => {
  // THE false positive the old implementation produced. It probed
  // `cache/<name>` directly, so any MARKETPLACE called `specnaut-plugin` read
  // as an installed plugin — and conversely, a real install never did.
  await withFakeHome(
    async (home) => {
      await Deno.mkdir(
        join(home, ".claude/plugins/cache/specnaut-plugin/some-other-plugin/1.0.0"),
        { recursive: true },
      );
      await writeRegistry(home, [{
        marketplace: "specnaut-plugin",
        plugin: "some-other-plugin",
        version: "1.0.0",
        installPath: join(
          home,
          ".claude/plugins/cache/specnaut-plugin/some-other-plugin/1.0.0",
        ),
      }]);
    },
    async (home) => {
      const det = new FsPluginDetector(home);
      assertEquals(
        await det.isPluginInstalled("specnaut-plugin"),
        false,
        "a marketplace directory was mistaken for a plugin installation",
      );
    },
  );
});

Deno.test("a plugin from any marketplace counts", async () => {
  // Deliberate, and written down in the implementation: Specnaut does not
  // control which marketplace a user adds, so pinning one would report a
  // genuine install as absent. The plugin NAME is the identity.
  await withFakeHome(
    async (home) => {
      await install(home, {
        marketplace: "some-community-fork",
        plugin: "specnaut-plugin",
        version: "1.2.3",
      });
    },
    async (home) => {
      const det = new FsPluginDetector(home);
      assertEquals(await det.isPluginInstalled("specnaut-plugin"), true);
    },
  );
});

Deno.test("a sibling plugin under the same marketplace is not a match", async () => {
  await withFakeHome(
    async (home) => {
      await install(home, {
        marketplace: "claude-plugins-official",
        plugin: "some-other-plugin",
        version: "0.0.4",
      });
    },
    async (home) => {
      const det = new FsPluginDetector(home);
      assertEquals(await det.isPluginInstalled("specnaut-plugin"), false);
    },
  );
});

Deno.test("an empty home reports not installed", async () => {
  await withFakeHome(
    async (_home) => {},
    async (home) => {
      const det = new FsPluginDetector(home);
      assertEquals(await det.isPluginInstalled("specnaut-plugin"), false);
    },
  );
});

Deno.test("an unresolvable HOME reports not installed", async () => {
  const det = new FsPluginDetector(null);
  assertEquals(await det.isPluginInstalled("specnaut-plugin"), false);
  assertEquals(await det.pluginHasPath("specnaut-plugin", "skills/board/SKILL.md"), false);
});

// ── Degradation: never throw, always fall back to "not installed" ──────────

Deno.test("a malformed registry degrades to the cache walk rather than throwing", async () => {
  // AC6. The safe default is load-bearing: a detector that throws takes
  // `specnaut upgrade` down with it, and a detector that guesses `true` deletes
  // files. The install is still discoverable on disk, so it is still found.
  await withFakeHome(
    async (home) => {
      await install(home, {
        marketplace: "specnaut-marketplace",
        plugin: "specnaut-plugin",
        version: "4.3.0",
      });
      await Deno.writeTextFile(
        join(home, ".claude/plugins/installed_plugins.json"),
        "{ this is not json",
      );
    },
    async (home) => {
      const det = new FsPluginDetector(home);
      assertEquals(
        await det.isPluginInstalled("specnaut-plugin"),
        true,
        "a corrupt registry hid an install that is plainly present on disk",
      );
    },
  );
});

Deno.test("a registry pointing at a vanished installPath reports not installed", async () => {
  await withFakeHome(
    async (home) => {
      await writeRegistry(home, [{
        marketplace: "specnaut-marketplace",
        plugin: "specnaut-plugin",
        version: "4.3.0",
        installPath: join(home, ".claude/plugins/cache/specnaut-marketplace/gone/4.3.0"),
      }]);
    },
    async (home) => {
      const det = new FsPluginDetector(home);
      assertEquals(await det.isPluginInstalled("specnaut-plugin"), false);
    },
  );
});

Deno.test("a cache entry that is a file, not a directory, reports not installed", async () => {
  await withFakeHome(
    async (home) => {
      await Deno.mkdir(join(home, ".claude/plugins/cache"), { recursive: true });
      await Deno.writeTextFile(join(home, ".claude/plugins/cache/specnaut-plugin"), "oops");
    },
    async (home) => {
      const det = new FsPluginDetector(home);
      assertEquals(await det.isPluginInstalled("specnaut-plugin"), false);
    },
  );
});

// ── pluginHasPath — the path-level probe (#606 AC4) ────────────────────────

Deno.test("pluginHasPath answers from the installed tree, not from a compile-time list", async () => {
  await withFakeHome(
    async (home) => {
      await install(
        home,
        { marketplace: "specnaut-marketplace", plugin: "specnaut-plugin", version: "4.3.0" },
        ["skills/board/SKILL.md", "agents/developer.md"],
      );
    },
    async (home) => {
      const det = new FsPluginDetector(home);
      assertEquals(await det.pluginHasPath("specnaut-plugin", "skills/board/SKILL.md"), true);
      assertEquals(await det.pluginHasPath("specnaut-plugin", "agents/developer.md"), true);
      // The case that matters: covered by the list, absent from THIS build.
      // Without this probe, upgrade deletes the project's copy of a file the
      // installed plugin version does not serve.
      assertEquals(
        await det.pluginHasPath("specnaut-plugin", "skills/ship/SKILL.md"),
        false,
        "a path the installed plugin does not carry was reported as served — " +
          "upgrade would delete the project's copy and nothing would replace it",
      );
    },
  );
});

Deno.test("pluginHasPath reports false when the plugin is not installed at all", async () => {
  await withFakeHome(
    async (_home) => {},
    async (home) => {
      const det = new FsPluginDetector(home);
      assertEquals(await det.pluginHasPath("specnaut-plugin", "skills/board/SKILL.md"), false);
    },
  );
});

Deno.test("pluginHasPath refuses to escape the plugin's own directory", async () => {
  // The probe takes a path assembled from a destination, so it must not be a
  // way to ask about arbitrary files on the machine.
  await withFakeHome(
    async (home) => {
      await install(home, {
        marketplace: "specnaut-marketplace",
        plugin: "specnaut-plugin",
        version: "4.3.0",
      });
      await Deno.writeTextFile(join(home, "secret.txt"), "s");
    },
    async (home) => {
      const det = new FsPluginDetector(home);
      for (
        const p of [
          "../../../../secret.txt",
          "/etc/hosts",
          "skills/../../../../secret.txt",
        ]
      ) {
        assertEquals(
          await det.pluginHasPath("specnaut-plugin", p),
          false,
          `${p} escaped the plugin directory`,
        );
      }
    },
  );
});

Deno.test("FsPluginDetector default constructor reads HOME from the environment", () => {
  const det = new FsPluginDetector();
  assertEquals(typeof det.isPluginInstalled, "function");
  assertEquals(typeof det.pluginHasPath, "function");
});
