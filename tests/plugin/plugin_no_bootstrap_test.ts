import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";

/**
 * Spec 034: the plugin distributions inject nothing at session start.
 *
 * The SessionStart bootstrap was part of the retired derived workflow. On
 * Cursor it also ran `bash ./plugin/hooks/session-start` — a path relative to
 * whatever directory the harness ran it from. So the hooks and every manifest
 * key that named them go together, and stay gone.
 *
 * What survives is discovery: each manifest still points the harness at
 * Specnaut's own skills (and agents, where the harness takes them).
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const json = async (p: string) => JSON.parse(await Deno.readTextFile(join(ROOT, p)));

Deno.test("no shipped plugin manifest declares a hook, and plugin/hooks/ is gone", async () => {
  assertEquals(await exists(join(ROOT, "plugin/hooks")), false, "plugin/hooks/ still ships");
  for (
    const m of [
      ".cursor-plugin/plugin.json",
      ".codex-plugin/plugin.json",
      "plugin/.claude-plugin/plugin.json",
    ]
  ) {
    const manifest = await json(m);
    assertEquals(manifest.hooks, undefined, `${m} still declares hooks`);
    assert(
      !JSON.stringify(manifest).toLowerCase().includes("bootstrap"),
      `${m} still describes a bootstrap`,
    );
  }
});

Deno.test("the manifests still point the harness at Specnaut's skills and agents", async () => {
  const cursor = await json(".cursor-plugin/plugin.json");
  assertEquals(cursor.skills, "./plugin/skills/");
  assertEquals(cursor.agents, "./plugin/agents/");
  assertEquals((await json(".codex-plugin/plugin.json")).skills, "./plugin/skills/");
  // Claude Code discovers skills/ and agents/ by convention under the plugin root.
  assert(await exists(join(ROOT, "plugin/skills/specnaut/SKILL.md")));
  assert(await exists(join(ROOT, "plugin/agents")));
});

Deno.test("the OpenCode plugin only registers the skills directory", async () => {
  const path = join(ROOT, ".opencode/plugins/specnaut.js");
  const source = await Deno.readTextFile(path);
  // An allowlist of imports, not a denylist of `fs`: `fs/promises`, `require`
  // and a dynamic `import()` would each slip past a pattern for one module.
  const imports = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]).sort();
  assertEquals(imports, ["path", "url"], "the registrar imports only path and url");
  assert(
    !/\brequire\s*\(|\bimport\s*\(|\bDeno\./.test(source),
    "no other way in to a module or the host",
  );
  assert(
    !/process\.(cwd|env)/.test(source),
    "the registrar must not read the cwd or the environment",
  );

  const mod = await import(`file://${path}`);
  const plugins = Object.values(mod).filter((v) => typeof v === "function") as Array<
    (ctx: Record<string, unknown>) => Promise<Record<string, unknown>>
  >;
  assertEquals(plugins.length, 1, "one plugin export");
  // A hostile `directory` must change nothing: the path comes from the module's own location.
  const hooks = await plugins[0]({ directory: "/tmp/hostile", client: {} });
  assertEquals(Object.keys(hooks), ["config"], "its only hook is config");

  type Config = Record<string, unknown> & { skills?: { paths?: string[] } };
  const run = (c: Config) => (hooks.config as (c: Config) => Promise<void>)(c);
  const SKILLS = join(ROOT, "plugin/skills");

  const empty: Config = {};
  await run(empty);
  assertEquals(empty, { skills: { paths: [SKILLS] } }, "it adds the path and nothing else");
  await run(empty);
  assertEquals(empty, { skills: { paths: [SKILLS] } }, "registering twice adds the path once");

  // A user's own config is kept as it was, apart from the one path.
  const theirs: Config = { model: "x", skills: { paths: ["/their/skills"] } };
  await run(theirs);
  assertEquals(theirs, { model: "x", skills: { paths: ["/their/skills", SKILLS] } });
});
