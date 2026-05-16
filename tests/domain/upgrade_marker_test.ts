import { assertEquals } from "@std/assert";
import { mergeMarker, type UpgradeMarker } from "../../src/domain/upgrade_marker.ts";

Deno.test("mergeMarker: fresh write when no existing marker", () => {
  const merged = mergeMarker(null, {
    from: "1.4.0",
    to: "1.5.0",
    at: "2026-05-16T00:00:00.000Z",
  });
  assertEquals(merged, {
    from: "1.4.0",
    to: "1.5.0",
    at: "2026-05-16T00:00:00.000Z",
  });
});

Deno.test("mergeMarker: chained upgrade preserves existing `from`", () => {
  const existing: UpgradeMarker = {
    from: "1.4.0",
    to: "1.5.0",
    at: "2026-05-16T00:00:00.000Z",
  };
  const merged = mergeMarker(existing, {
    from: "1.5.0",
    to: "1.6.0",
    at: "2026-05-16T01:00:00.000Z",
  });
  assertEquals(merged, {
    from: "1.4.0",
    to: "1.6.0",
    at: "2026-05-16T01:00:00.000Z",
  });
});

Deno.test("mergeMarker: same `to` rewrites `at` only", () => {
  const existing: UpgradeMarker = {
    from: "1.4.0",
    to: "1.5.0",
    at: "2026-05-16T00:00:00.000Z",
  };
  const merged = mergeMarker(existing, {
    from: "1.5.0",
    to: "1.5.0",
    at: "2026-05-16T01:00:00.000Z",
  });
  assertEquals(merged.from, "1.4.0");
  assertEquals(merged.to, "1.5.0");
  assertEquals(merged.at, "2026-05-16T01:00:00.000Z");
});
