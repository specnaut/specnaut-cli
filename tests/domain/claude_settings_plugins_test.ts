import { assertEquals } from "@std/assert";
import {
  mergeClaudeSettings,
  pluginDeclarationNotes,
} from "../../src/domain/claude_settings_merge.ts";

// Split out of claude_settings_merge_test.ts (spec 036) to keep both under the
// size target; the shipped file and the destination are the same.
const DEST = ".claude/settings.json";
const SHIPPED = Deno.readTextFileSync(
  new URL("../../templates/harness-specific/claude/settings.json", import.meta.url),
);

// ── Plugin declarations (#642) ─────────────────────────────────────────────
// The shipped settings declare Specnaut's marketplace and enable the cockpit
// mod, so Claude Code offers both when a person trusts the project. A key the
// user already has is theirs: `false` declines the cockpit for good.

const COCKPIT = "specnaut-cockpit@specnaut-marketplace";

const SHIPPED_SOURCE = JSON.parse(SHIPPED).extraKnownMarketplaces?.["specnaut-marketplace"]?.source;

Deno.test("claude settings: the shipped marketplace is this repository's catalog, pinned to a tag (#642)", () => {
  // Pinned, so a teammate who trusts the project installs the cockpit of the
  // binary that scaffolded it — not whatever a branch holds at install time.
  assertEquals(SHIPPED_SOURCE.source, "github");
  assertEquals(SHIPPED_SOURCE.repo, "specnaut/specnaut-cli");
  assertEquals(SHIPPED_SOURCE.path, "packaging/marketplace/.claude-plugin/marketplace.json");
  assertEquals(/^v\d+\.\d+\.\d+$/.test(SHIPPED_SOURCE.ref), true, SHIPPED_SOURCE.ref);
  assertEquals(JSON.parse(SHIPPED).enabledPlugins?.[COCKPIT], true);
});

Deno.test("mergeClaudeSettings: an existing project gains the marketplace and the cockpit (#642)", () => {
  const existing = JSON.stringify({
    enabledPlugins: { "other@elsewhere": true },
    extraKnownMarketplaces: { elsewhere: { source: { source: "github", repo: "o/r" } } },
  });
  const merged = JSON.parse(mergeClaudeSettings(existing, SHIPPED, DEST).content);
  assertEquals(merged.enabledPlugins, { "other@elsewhere": true, [COCKPIT]: true });
  assertEquals(Object.keys(merged.extraKnownMarketplaces), ["elsewhere", "specnaut-marketplace"]);
});

Deno.test("mergeClaudeSettings: a project's `false` for the cockpit survives every upgrade (#642)", () => {
  const existing = JSON.stringify({ enabledPlugins: { [COCKPIT]: false } });
  const once = mergeClaudeSettings(existing, SHIPPED, DEST).content;
  const twice = mergeClaudeSettings(once, SHIPPED, DEST).content;
  assertEquals(JSON.parse(twice).enabledPlugins[COCKPIT], false);
  assertEquals(twice, once);
});

Deno.test("mergeClaudeSettings: a marketplace the user re-pointed is left as they set it (#642)", () => {
  const mine = { source: { source: "github", repo: "my-fork/specnaut-marketplace" } };
  const existing = JSON.stringify({ extraKnownMarketplaces: { "specnaut-marketplace": mine } });
  const merged = JSON.parse(mergeClaudeSettings(existing, SHIPPED, DEST).content);
  assertEquals(merged.extraKnownMarketplaces["specnaut-marketplace"], mine);
});

Deno.test("mergeClaudeSettings: Specnaut's own marketplace is re-pinned to this release (#642)", () => {
  const older = { ...SHIPPED_SOURCE, ref: "v0.0.1" };
  const existing = JSON.stringify({
    extraKnownMarketplaces: { "specnaut-marketplace": { source: older } },
  });
  const merged = JSON.parse(mergeClaudeSettings(existing, SHIPPED, DEST).content);
  assertEquals(
    merged.extraKnownMarketplaces["specnaut-marketplace"].source.ref,
    SHIPPED_SOURCE.ref,
  );
  assertEquals(pluginDeclarationNotes(existing, SHIPPED, DEST), [
    `${DEST}: re-pinned the marketplace specnaut-marketplace from v0.0.1 to ${SHIPPED_SOURCE.ref}`,
    `${DEST}: enabled ${COCKPIT} — Claude Code offers to install it when the project is trusted; it runs code in Claude Code. Set it to false to decline`,
  ]);
});

Deno.test("pluginDeclarationNotes: a re-pointed marketplace is kept, and said (#642)", () => {
  const fork = { source: "github", repo: "my-fork/specnaut-marketplace" };
  const existing = JSON.stringify({
    extraKnownMarketplaces: { "specnaut-marketplace": { source: fork } },
    enabledPlugins: { [COCKPIT]: false },
  });
  const notes = pluginDeclarationNotes(existing, SHIPPED, DEST);
  assertEquals(notes.length, 1);
  assertEquals(
    notes[0].includes(
      "kept the marketplace specnaut-marketplace pointed at my-fork/specnaut-marketplace",
    ),
    true,
    notes[0],
  );
});

Deno.test("pluginDeclarationNotes: nothing to say on a fresh scaffold or a project already up to date", () => {
  assertEquals(pluginDeclarationNotes(null, SHIPPED, DEST), []);
  assertEquals(
    pluginDeclarationNotes(mergeClaudeSettings(null, SHIPPED, DEST).content, SHIPPED, DEST),
    [],
  );
});
