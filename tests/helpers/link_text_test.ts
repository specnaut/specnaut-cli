import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { readLinkText, WINDOWS } from "./link_text.ts";

/**
 * The helper must not loosen the comparison off Windows: there a `\` in a
 * link's text is a literal character, and a link written with one is broken.
 */
Deno.test({
  name: "readLinkText keeps a backslash verbatim off Windows",
  ignore: WINDOWS,
  async fn() {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.symlink("..\\AGENTS.md", join(dir, "link.md"));
      assertEquals(await readLinkText(join(dir, "link.md")), "..\\AGENTS.md");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
