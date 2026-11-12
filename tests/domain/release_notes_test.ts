import { assertEquals, assertThrows } from "@std/assert";
import { crossedReleases, releaseUrl } from "../../src/domain/release_notes.ts";
import { SemVer } from "../../src/domain/release.ts";

/**
 * Which releases an upgrade crossed (cli#759): the history's entries in
 * (from, to], in version order. The history is the only list of releases the
 * binary has, so a release without an entry is never invented, and a range that
 * starts before the oldest entry says so once.
 */

// Deliberately out of order: the bundler sorts, but the rule must not rely on it.
const HISTORY = [
  { version: "3.0.0", content: "**Three.**\n" },
  { version: "9.1.0", content: "**Nine one.**\n" },
  { version: "10.0.0", content: "**Ten.**\n" },
  { version: "9.2.0", content: "**Nine two.**\n" },
  { version: "9.0.1", content: "" },
  // A release candidate sorts inside (9.1.0, 9.2.0]: whether it is crossed is a rule, not an accident.
  { version: "9.2.0-rc.1", content: "**Nine two, candidate.**\n" },
];

const versions = (from: string, to: string) => {
  const notes = crossedReleases(from, to, HISTORY);
  return notes.kind === "crossed" ? notes.releases.map((r) => r.version) : notes.kind;
};

Deno.test("the range is (from, to]: from excluded, to included", () => {
  assertEquals(versions("9.0.1", "9.2.0"), ["9.1.0", "9.2.0"]);
});

Deno.test("releases come in version order, not the history's order", () => {
  // "10.0.0" sorts before "9.x" as a string: a lexical sort would put it first.
  assertEquals(versions("9.0.0", "10.0.0"), ["9.0.1", "9.1.0", "9.2.0", "10.0.0"]);
});

Deno.test("a release whose highlights are empty is listed, with none", () => {
  const notes = crossedReleases("9.0.0", "9.0.1", HISTORY);
  assertEquals(notes.kind, "crossed");
  if (notes.kind !== "crossed") return;
  assertEquals(notes.releases, [
    { version: "9.0.1", highlights: null, url: releaseUrl(SemVer.parse("9.0.1")) },
  ]);
});

Deno.test("each release carries its highlights and its link", () => {
  const notes = crossedReleases("9.1.0", "9.2.0", HISTORY);
  if (notes.kind !== "crossed") throw new Error(notes.kind);
  assertEquals(notes.releases[0].highlights, "**Nine two.**\n");
  assertEquals(
    notes.releases[0].url,
    "https://github.com/specnaut/specnaut-cli/releases/tag/v9.2.0",
  );
});

Deno.test("a range starting before the oldest entry names it once", () => {
  const notes = crossedReleases("2.1.0", "3.0.0", HISTORY);
  if (notes.kind !== "crossed") throw new Error(notes.kind);
  assertEquals(notes.recordedSince, "3.0.0");
  assertEquals(notes.releases.map((r) => r.version), ["3.0.0"]);
});

Deno.test("a range inside the record has no gap to name", () => {
  const notes = crossedReleases("3.0.0", "9.1.0", HISTORY);
  if (notes.kind !== "crossed") throw new Error(notes.kind);
  assertEquals(notes.recordedSince, null);
});

Deno.test("the same version on both ends is no change", () => {
  assertEquals(crossedReleases("9.2.0", "9.2.0", HISTORY), { kind: "no-change" });
});

Deno.test("a downgrade or a version that is not SemVer crosses nothing", () => {
  assertEquals(crossedReleases("10.0.0", "9.2.0", HISTORY), { kind: "none" });
  assertEquals(crossedReleases("dev", "9.2.0", HISTORY), { kind: "none" });
  assertEquals(crossedReleases("9.2.0", "", HISTORY), { kind: "none" });
});

/**
 * A stable target skips prerelease records; a prerelease target keeps them
 * (cli#775). The stable release's own record already says what its candidates
 * shipped, so listing them repeats it under names the user never installed;
 * a user who opted into a prerelease follows candidates and wants each one.
 */
Deno.test("a stable-to-stable upgrade across a recorded candidate does not list it", () => {
  assertEquals(versions("9.1.0", "9.2.0"), ["9.2.0"]);
});

Deno.test("an upgrade to a prerelease lists the prereleases it crossed", () => {
  assertEquals(versions("9.0.1", "9.2.0-rc.1"), ["9.1.0", "9.2.0-rc.1"]);
});

Deno.test("a history entry whose version does not parse fails loudly, never vanishes", () => {
  // The bundler owns the name rule and refuses such a file; one reaching here
  // is a broken bundle, which must not print a shorter list as if it were whole.
  const broken = [...HISTORY, { version: "nine", content: "**Lost.**\n" }];
  assertThrows(() => crossedReleases("9.0.0", "10.0.0", broken), Error, '"nine"');
});
