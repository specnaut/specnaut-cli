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

Deno.test({
  name: "a source that cannot be read for another reason than absence is that error, by path",
  // No permission bits to take away on Windows, and none that bind root.
  ignore: Deno.build.os === "windows" || Deno.env.get("USER") === "root",
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "bundle-manifest-" });
    const locked = `${dir}/locked`;
    try {
      await Deno.mkdir(locked);
      await Deno.writeTextFile(`${locked}/plan.md`, "x");
      await Deno.chmod(locked, 0o000);
      const only = { ...manifest, core: [{ ...manifest.core[0], source: "locked/plan.md" }] };
      const read = () =>
        assertAllSourcesPresent({ ...only, harness_static: [] }, toFileUrl(`${dir}/`));
      const err = await assertRejects(read, Error, "locked/plan.md");
      assertEquals(err.message.includes("Missing template sources"), false, err.message);
    } finally {
      await Deno.chmod(locked, 0o755);
      await Deno.remove(dir, { recursive: true });
    }
  },
});
