import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const SOURCE = fromFileUrl(
  new URL("../../templates/core/skills/auto-chain/SKILL.md", import.meta.url),
);
const PLUGIN_COPY = fromFileUrl(
  new URL("../../plugin/skills/auto-chain/SKILL.md", import.meta.url),
);

Deno.test(
  "plugin/skills/auto-chain/SKILL.md is byte-identical to templates/core/skills/auto-chain/SKILL.md",
  async () => {
    const [src, plugin] = await Promise.all([
      Deno.readTextFile(SOURCE),
      Deno.readTextFile(PLUGIN_COPY),
    ]);
    assertEquals(
      plugin,
      src,
      "Plugin copy of auto-chain has drifted from the bundled source. " +
        "Either: (a) update plugin/skills/auto-chain/SKILL.md to match templates/core/skills/auto-chain/SKILL.md, " +
        "or (b) if the divergence is intentional, drop this test and document why.",
    );
  },
);

Deno.test(
  "plugin/.claude-plugin/plugin.json declares name 'claude-specflow'",
  async () => {
    const path = fromFileUrl(
      new URL("../../plugin/.claude-plugin/plugin.json", import.meta.url),
    );
    const manifest = JSON.parse(await Deno.readTextFile(path));
    assertEquals(manifest.name, "claude-specflow");
    assertEquals(typeof manifest.description, "string");
    assertEquals(typeof manifest.version, "string");
  },
);
