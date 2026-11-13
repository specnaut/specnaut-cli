import { assertEquals, assertRejects } from "@std/assert";
import { toFileUrl } from "@std/path";
import {
  assertAllSourcesPresent,
  type Manifest,
  manifestSources,
} from "../../scripts/bundle-manifest.ts";

/** A manifest whose sources are not all there fails the build, naming each one missing. */

const manifest: Manifest = {
  version: "1",
  core: [{ category: "skills", name: "plan", source: "plan.md" }],
  harness_static: [
    { harness: "claude", destination: "CLAUDE.md", link: "../AGENTS.md", fallback: "@AGENTS.md" },
    { harness: "claude", destination: "s.json", source: "s.json" },
  ],
};

Deno.test("every source is checked but a link entry's, which has no file behind it", () => {
  assertEquals(manifestSources(manifest), ["plan.md", "s.json"]);
});

Deno.test("a missing source, or a folder in its place, fails the build by name", async () => {
  const dir = await Deno.makeTempDir({ prefix: "bundle-manifest-" });
  try {
    const templates = toFileUrl(`${dir}/`);
    await Deno.writeTextFile(`${dir}/plan.md`, "x");
    await Deno.mkdir(`${dir}/s.json`);
    const err = await assertRejects(() => assertAllSourcesPresent(manifest, templates), Error);
    assertEquals(err.message, "Missing template sources:\n  - s.json");
    await Deno.remove(`${dir}/s.json`);
    await Deno.writeTextFile(`${dir}/s.json`, "{}");
    await assertAllSourcesPresent(manifest, templates);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
