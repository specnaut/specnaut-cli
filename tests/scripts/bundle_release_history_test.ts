import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { historyFileProblems, readReleaseHistory } from "../../scripts/bundle-release-history.ts";

/**
 * The bundler refuses a release-history file it would embed with a character a
 * terminal or a reading agent could be misled by (cli#759, FR-005). The text is
 * printed as is at upgrade time, so this refusal is its only check: each class
 * has its own case, and each must fail the bundle on its own.
 */

async function historyDir(files: Record<string, string>): Promise<URL> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-history-" });
  for (const [name, content] of Object.entries(files)) {
    await Deno.writeTextFile(join(dir, name), content);
  }
  return toFileUrl(`${dir}/`);
}

const CLASSES: Array<[string, string, string]> = [
  ["a C0 control", "**Lead.**\u001b[31m red\n", "C0 control"],
  ["a tab", "**Lead.**\tindented\n", "C0 control"],
  ["a bare carriage return", "**Lead.**\rover\n", "C0 control"],
  ["DEL", "**Lead.**\u007f\n", "C0 control"],
  ["a C1 control", "**Lead.**\u009b31m\n", "C1 control"],
  ["a bidi override", "**Lead.** \u202eevil\n", "bidi"],
  ["a bidi isolate", "**Lead.** \u2066evil\u2069\n", "bidi"],
  ["a zero-width space", "**Lead.**\u200b\n", "zero-width"],
  ["a byte-order mark", "\ufeff**Lead.**\n", "zero-width"],
  ["CRLF line endings", "**Lead.**\r\nNext.\r\n", "CRLF"],
];

for (const [what, content, named] of CLASSES) {
  Deno.test(`a history file holding ${what} fails the bundle`, async () => {
    const dir = await historyDir({ "v1.0.0.md": "**Fine.**\n", "v1.1.0.md": content });
    const err = await assertRejects(() => readReleaseHistory(dir), Error);
    assertStringIncludes(err.message, "v1.1.0.md");
    assertStringIncludes(err.message, named);
  });
}

Deno.test("CRLF is named once, not again as a carriage return", () => {
  assertEquals(historyFileProblems("v1.0.0.md", "a\r\nb\r\n").length, 1);
});

for (const name of ["9.1.0.md", "v9.1.md", "v09.1.0.md", "vv9.1.0.md", "v9.1.0.txt", "notes.md"]) {
  Deno.test(`a history file named ${name} fails the bundle`, async () => {
    const dir = await historyDir({ [name]: "**Lead.**\n" });
    const err = await assertRejects(() => readReleaseHistory(dir), Error);
    assertStringIncludes(err.message, name);
  });
}

Deno.test("plain Markdown, an empty file and non-ASCII prose are accepted", async () => {
  const dir = await historyDir({
    "v1.0.0.md": "**Lead — with a dash.** Café, `code`, émoji-free.\n\nSecond paragraph.\n",
    "v1.0.1.md": "",
  });
  assertEquals(await readReleaseHistory(dir), [
    {
      version: "1.0.0",
      content: "**Lead — with a dash.** Café, `code`, émoji-free.\n\nSecond paragraph.\n",
    },
    { version: "1.0.1", content: "" },
  ]);
});

Deno.test("the history is read in version order", async () => {
  const dir = await historyDir({ "v10.0.0.md": "", "v9.0.0.md": "", "v9.10.0.md": "" });
  assertEquals((await readReleaseHistory(dir)).map((e) => e.version), [
    "9.0.0",
    "9.10.0",
    "10.0.0",
  ]);
});

Deno.test("the committed history passes its own check", async () => {
  const real = new URL("../../.specnaut/release/history/", import.meta.url);
  const history = await readReleaseHistory(real);
  assertEquals(history.length > 0, true);
});
