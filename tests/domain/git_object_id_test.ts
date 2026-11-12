import { assertEquals } from "@std/assert";
import { formatOf, gitBlobId, hex, idBytes } from "../../src/domain/git_object_id.ts";

const hashObject = async (bytes: Uint8Array, format: string): Promise<string> => {
  const dir = await Deno.makeTempDir({ prefix: "blob-id-" });
  try {
    await new Deno.Command("git", { args: ["init", "-q", `--object-format=${format}`], cwd: dir })
      .output();
    const child = new Deno.Command("git", {
      args: ["hash-object", "--stdin"],
      cwd: dir,
      stdin: "piped",
      stdout: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(bytes);
    await writer.close();
    return new TextDecoder().decode((await child.output()).stdout).trim();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
};

Deno.test("a blob id is the one git computes, in both object formats", async () => {
  for (
    const bytes of [new Uint8Array(), new TextEncoder().encode("hi\n"), new Uint8Array([0, 255])]
  ) {
    assertEquals(await gitBlobId(bytes, "sha1"), await hashObject(bytes, "sha1"));
    assertEquals(await gitBlobId(bytes, "sha256"), await hashObject(bytes, "sha256"));
  }
});

Deno.test("the object format follows the id's length", () => {
  assertEquals(formatOf("a".repeat(40)), "sha1");
  assertEquals(formatOf("a".repeat(64)), "sha256");
});

Deno.test("an id is spelled as git prints it, and takes half its length in raw bytes", () => {
  assertEquals(hex(new Uint8Array([0, 15, 171, 255])), "000fabff");
  assertEquals([idBytes("a".repeat(40)), idBytes("a".repeat(64))], [20, 32]);
});
