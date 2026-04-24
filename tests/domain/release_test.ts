import { assertEquals, assertThrows } from "@std/assert";
import { Release, SemVer } from "../../src/domain/release.ts";

Deno.test("SemVer.parse accepts plain semver", () => {
  const v = SemVer.parse("1.2.3");
  assertEquals(v.major, 1);
  assertEquals(v.minor, 2);
  assertEquals(v.patch, 3);
  assertEquals(v.prerelease, null);
});

Deno.test("SemVer.parse accepts prereleases", () => {
  const v = SemVer.parse("0.1.0-alpha.1");
  assertEquals(v.prerelease, "alpha.1");
});

Deno.test("SemVer.parse accepts leading v", () => {
  const v = SemVer.parse("v2.0.0");
  assertEquals(v.major, 2);
});

Deno.test("SemVer.parse rejects garbage", () => {
  assertThrows(() => SemVer.parse("not-a-version"));
});

Deno.test("SemVer.compare orders correctly", () => {
  const a = SemVer.parse("1.0.0");
  const b = SemVer.parse("1.0.1");
  const c = SemVer.parse("1.0.0-alpha");
  assertEquals(a.compare(b), -1);
  assertEquals(b.compare(a), 1);
  assertEquals(a.compare(a), 0);
  assertEquals(c.compare(a), -1);
});

Deno.test("SemVer.isNewerThan is the ergonomic helper", () => {
  const a = SemVer.parse("1.0.0");
  const b = SemVer.parse("1.0.1");
  assertEquals(b.isNewerThan(a), true);
  assertEquals(a.isNewerThan(b), false);
});

Deno.test("Release.assetFor returns the matching asset by platform triple", () => {
  const release = new Release(
    SemVer.parse("0.1.0"),
    [
      { name: "specflow-macos-arm64", url: "https://x/macos-arm64" },
      { name: "specflow-linux-x64", url: "https://x/linux-x64" },
    ],
  );
  assertEquals(release.assetFor("macos-arm64")?.name, "specflow-macos-arm64");
  assertEquals(release.assetFor("linux-x64")?.name, "specflow-linux-x64");
  assertEquals(release.assetFor("bogus"), null);
});
