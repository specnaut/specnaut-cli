import { assertEquals } from "@std/assert";
import { stripAnsiCode } from "@std/fmt/colors";
import { releaseNotesLines } from "../../../src/cli/handlers/upgrade_notes.ts";

/** The block `specnaut upgrade` prints for the releases it crossed (cli#759). */

const lines = (notes: Parameters<typeof releaseNotesLines>[0]) =>
  releaseNotesLines(notes).map(stripAnsiCode);

const url = (v: string) => `https://github.com/specnaut/specnaut-cli/releases/tag/v${v}`;

Deno.test("no version change says so and shows nothing else (S2)", () => {
  assertEquals(lines({ kind: "no-change" }), [
    "No version change — no release notes to show.",
  ]);
});

Deno.test("each crossed release prints its highlights, then its link", () => {
  assertEquals(
    lines({
      kind: "crossed",
      recordedSince: null,
      releases: [
        { version: "9.1.0", highlights: "**One.**\n\nTwo.\n", url: url("9.1.0") },
        { version: "9.2.0", highlights: "**Three.**\n", url: url("9.2.0") },
      ],
    }),
    [
      "",
      "What's new in the releases this upgrade crossed:",
      "",
      "── v9.1.0",
      "**One.**\n\nTwo.",
      `Full notes: ${url("9.1.0")}`,
      "",
      "── v9.2.0",
      "**Three.**",
      `Full notes: ${url("9.2.0")}`,
    ],
  );
});

Deno.test("a release without highlights says so and still links (S3)", () => {
  const out = lines({
    kind: "crossed",
    recordedSince: null,
    releases: [{ version: "5.0.1", highlights: null, url: url("5.0.1") }],
  });
  assertEquals(out.slice(-2), ["No highlights for this release.", `Full notes: ${url("5.0.1")}`]);
});

Deno.test("a range older than the record names the gap once, before the releases", () => {
  const out = lines({
    kind: "crossed",
    recordedSince: "3.0.0",
    releases: [{ version: "3.0.0", highlights: "**Lead.**\n", url: url("3.0.0") }],
  });
  assertEquals(out.filter((l) => l.includes("published no highlights")), [
    "Releases before v3.0.0 published no highlights.",
  ]);
  assertEquals(out.indexOf("Releases before v3.0.0 published no highlights.") < 4, true);
});

Deno.test("no range prints nothing", () => {
  assertEquals(lines({ kind: "none" }), []);
  assertEquals(lines({ kind: "crossed", recordedSince: null, releases: [] }), []);
});
