import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { historyFileProblems, readReleaseHistory } from "../../scripts/bundle-release-history.ts";

/**
 * The bundler refuses a release-history file it would embed with a character a
 * terminal or a reading agent could be misled by (cli#759, FR-005). The text is
 * printed as is at upgrade time, so this refusal is its only check: each class
 * has its own case, and each must fail the bundle on its own.
 */

/** A temp history directory holding `files`, removed when the test's `await using` ends. */
async function historyDir(files: Record<string, string>): Promise<AsyncDisposable & { url: URL }> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-history-" });
  for (const [name, content] of Object.entries(files)) {
    await Deno.writeTextFile(join(dir, name), content);
  }
  return {
    url: toFileUrl(`${dir}/`),
    [Symbol.asyncDispose]: () => Deno.remove(dir, { recursive: true }),
  };
}

Deno.test("each history directory is removed once its test is done", async () => {
  let url: URL;
  {
    await using dir = await historyDir({ "v1.0.0.md": "" });
    url = dir.url;
  }
  await assertRejects(() => Deno.stat(url), Deno.errors.NotFound);
});

/**
 * Refused by Unicode property, not by a list of ranges (cli#775): control
 * (Cc), format (Cf), line and paragraph separators (Zl, Zp) and every
 * default-ignorable code point. A list misses the invisible ones an agent still
 * reads — Tag characters, invisible operators, variation selectors, Hangul
 * fillers — so each case names the code point the refusal must report.
 */
const CLASSES: Array<[string, string, string]> = [
  ["a C0 control", "**Lead.**\u001b[31m red\n", "U+001B"],
  ["a tab", "**Lead.**\tindented\n", "U+0009"],
  ["a bare carriage return", "**Lead.**\rover\n", "U+000D"],
  ["DEL", "**Lead.**\u007f\n", "U+007F"],
  ["a C1 control", "**Lead.**\u009b31m\n", "U+009B"],
  ["a bidi override", "**Lead.** \u202eevil\n", "U+202E"],
  ["a bidi isolate", "**Lead.** \u2066evil\u2069\n", "U+2066"],
  ["a zero-width space", "**Lead.**\u200b\n", "U+200B"],
  ["a byte-order mark", "\ufeff**Lead.**\n", "U+FEFF"],
  ["a Unicode Tag character", "**Lead.**\u{E0041}\n", "U+E0041"],
  ["an invisible operator", "**Lead.** a\u2062b\n", "U+2062"],
  ["a variation selector", "**Lead.** a\ufe0f\n", "U+FE0F"],
  ["a Hangul filler", "**Lead.** \u3164\n", "U+3164"],
  ["a line separator", "**Lead.**\u2028Next.\n", "U+2028"],
  ["a paragraph separator", "**Lead.**\u2029Next.\n", "U+2029"],
  ["CRLF line endings", "**Lead.**\r\nNext.\r\n", "CRLF"],
];

for (const [what, content, named] of CLASSES) {
  Deno.test(`a history file holding ${what} fails the bundle`, async () => {
    await using dir = await historyDir({ "v1.0.0.md": "**Fine.**\n", "v1.1.0.md": content });
    const err = await assertRejects(() => readReleaseHistory(dir.url), Error);
    assertStringIncludes(err.message, "v1.1.0.md");
    assertStringIncludes(err.message, named);
  });
}

for (const [cp, ch] of [["U+FE0F", "\ufe0f"], ["U+200D", "\u200d"]]) {
  Deno.test(`a refused ${cp} says an emoji caused it, naming the file and line`, () => {
    // Both hide inside an emoji (a presentation selector, a joiner): the code
    // point alone sends the author hunting for a character they never typed.
    const [problem] = historyFileProblems("v1.0.0.md", `**Lead.**\nShipped \u2764${ch}\n`);
    assertStringIncludes(problem, `v1.0.0.md: `);
    assertStringIncludes(problem, `${cp} on line 2`);
    assertStringIncludes(problem, "emoji");
  });
}

Deno.test("CRLF is named once, not again as a carriage return", () => {
  assertEquals(historyFileProblems("v1.0.0.md", "a\r\nb\r\n").length, 1);
});

for (const name of ["9.1.0.md", "v9.1.md", "v09.1.0.md", "vv9.1.0.md", "v9.1.0.txt", "notes.md"]) {
  Deno.test(`a history file named ${name} fails the bundle`, async () => {
    await using dir = await historyDir({ [name]: "**Lead.**\n" });
    const err = await assertRejects(() => readReleaseHistory(dir.url), Error);
    assertStringIncludes(err.message, `${name}: not named v<MAJOR.MINOR.PATCH[-PRERELEASE]>.md`);
  });
}

Deno.test("a prerelease's history file is accepted under its own name", async () => {
  await using dir = await historyDir({ "v1.0.0-rc.1.md": "**Candidate.**\n" });
  assertEquals((await readReleaseHistory(dir.url)).map((e) => e.version), ["1.0.0-rc.1"]);
});

Deno.test("plain Markdown, an empty file and non-ASCII prose are accepted", async () => {
  await using dir = await historyDir({
    "v1.0.0.md": "**Lead — with a dash.** Café, `code`, émoji-free.\n\nSecond paragraph.\n",
    "v1.0.1.md": "",
  });
  assertEquals(await readReleaseHistory(dir.url), [
    {
      version: "1.0.0",
      content: "**Lead — with a dash.** Café, `code`, émoji-free.\n\nSecond paragraph.\n",
    },
    { version: "1.0.1", content: "" },
  ]);
});

Deno.test("the history is read in version order", async () => {
  await using dir = await historyDir({ "v10.0.0.md": "", "v9.0.0.md": "", "v9.10.0.md": "" });
  assertEquals((await readReleaseHistory(dir.url)).map((e) => e.version), [
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

Deno.test("the committed history always checks out LF, so Windows bundles it too", () => {
  // The refusal above reads the checkout's bytes: Windows' CRLF checkout once
  // turned every history file into a refused one there and nowhere else.
  // So do the fixtures the integration test compares the history with.
  for (
    const file of [
      ".specnaut/release/history/v9.2.0.md",
      "tests/fixtures/release_highlights/v9.1.0.md",
    ]
  ) {
    const attr = new Deno.Command("git", {
      args: ["check-attr", "eol", "--", file],
      cwd: new URL("../../", import.meta.url),
    }).outputSync();
    assertEquals(
      new TextDecoder().decode(attr.stdout).trim(),
      `${file}: eol: lf`,
      `.gitattributes must mark ${file} eol=lf`,
    );
  }
});
