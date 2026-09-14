import { assert, assertEquals, assertThrows } from "@std/assert";
import { HARNESSES } from "../../../src/cli/harnesses.ts";
import { everyBundleOption } from "../../../src/application/ports.ts";
import { CORE_BUNDLE } from "../../../src/templates_bundle.ts";
import type { CoreBundle, CoreEntry } from "../../../src/domain/core_bundle.ts";
import { addUnique } from "../../../src/infrastructure/harness/bundle_writer.ts";
import type { Bundle } from "../../../src/domain/template.ts";

/**
 * No two bundle entries may reach the same destination (spec 033 FR-006).
 *
 * A collision is `out[dest] = file` twice on a plain object: the second write
 * wins, silently, and one bundled file never reaches the user. Nothing in the
 * build could report it — which is why the refusal lives at the write site in
 * `addUnique` and this file is the second opinion rather than the only one.
 *
 * The hazard is real rather than theoretical. Flat harnesses (Windsurf,
 * Copilot) have no folders, so two skills' sub-documents are separated ONLY by
 * the owner prefix in their filename: the moment a second top-level skill owns
 * a document whose name matches one of `specnaut`'s, they compete for one path.
 */

/** Every harness, every install-parameter combination. */
function sweep(fn: (harnessKey: string, bundle: Bundle) => void): void {
  for (const opts of everyBundleOption()) {
    for (const h of HARNESSES) {
      fn(h.key, h.mapBundle(CORE_BUNDLE, opts));
    }
  }
}

Deno.test("no harness maps two bundle entries to one destination, in any combination", () => {
  // `mapBundle` itself refuses a duplicate, so reaching the end of the sweep IS
  // the assertion. Counting keys afterwards could not detect a collision — by
  // then the overwrite has already happened and the map is one key short, with
  // nothing saying which key is missing.
  let combinations = 0;
  sweep((_key, bundle) => {
    combinations++;
    assert(Object.keys(bundle).length > 0, "a harness produced an empty bundle");
  });
  // Guards against the whole sweep vacuously passing because the parameter
  // space came back empty — the failure mode #562 recorded, where a check
  // measured half the combinations and reported itself green.
  //
  // Pinned to LITERALS, not to the same expressions the loops iterate. An
  // earlier version asserted `combinations === everyBundleOption().length *
  // HARNESSES.length`, which is `N*M === N*M` and cannot fail: with an empty
  // HARNESSES both sides are 0, the callback never runs, and the sweep reports
  // green having tested nothing. That is #562 reproduced inside its own guard.
  assertEquals(HARNESSES.length, 7, "a harness was added or lost");
  assertEquals(everyBundleOption().length, 32, "the install parameter space changed size");
  assertEquals(combinations, 224, "the sweep did not cover every harness × combination");
});

Deno.test("addUnique refuses the second write and names the destination", () => {
  const out: Bundle = {};
  addUnique(out, ".claude/skills/a/doc.md", { content: "first", executable: false }, "claude");
  const err = assertThrows(
    () =>
      addUnique(out, ".claude/skills/a/doc.md", { content: "second", executable: false }, "claude"),
    Error,
  );
  assert(
    err.message.includes(".claude/skills/a/doc.md"),
    "the refusal must name the destination — a collision the message does not " +
      `locate costs the reader the search it exists to save. Got: ${err.message}`,
  );
  assert(err.message.includes("claude"), "the refusal must name the harness");
  // The first write survives: refusing is not the same as corrupting.
  assert(out[".claude/skills/a/doc.md"].content === "first");
});

Deno.test("the owner-prefix rule is not injective, and the guard catches it", () => {
  // THE REAL HAZARD, and it is not "two identical entries" — any `hasOwn` check
  // catches those. On a flat harness the destination is `${owner}-${doc}`, and
  // that concatenation is ambiguous: the separator is also a legal character in
  // both halves. These two DIFFERENT sub-documents, owned by two DIFFERENT
  // skills, land on one file:
  //
  //   owner `specnaut`, doc `ship-release.md` -> specnaut-ship-release.md
  //   owner `ship`,     doc `release.md`      -> specnaut-ship-release.md
  //
  // An earlier version of this test used two byte-identical entries and claimed
  // in its comment to be testing the cross-owner case. It was not: it never
  // exercised the prefix boundary at all, which is the one place this guard is
  // load-bearing.
  const ambiguous: CoreBundle = [
    {
      category: "phase",
      name: "specnaut",
      suffix: "ship-release.md",
      content: "a",
      executable: false,
    },
    { category: "phase", name: "ship", suffix: "release.md", content: "b", executable: false },
  ] as ReadonlyArray<CoreEntry>;

  const opts = everyBundleOption()[0];
  const FLAT = ["windsurf", "copilot"];

  for (const h of HARNESSES) {
    if (FLAT.includes(h.key)) {
      assertThrows(
        () => h.mapBundle(ambiguous, opts),
        Error,
        undefined,
        `${h.key} is flat, so these two documents share a filename — it must refuse them`,
      );
    } else {
      // Nested harnesses give each owner a folder, so the pair is unambiguous
      // there. Asserting this is what stops the guard being "refuses whenever
      // two entries look alike", which would be a different and wrong rule.
      //
      // Assert that BOTH DOCUMENTS SURVIVE, not that the bundle has two keys:
      // `mapBundle` also layers HARNESS_STATIC on top, so a key count measures
      // the static file list rather than the thing under test.
      const bundle = h.mapBundle(ambiguous, opts);
      const landed = Object.entries(bundle)
        .filter(([, f]) => f.content === "a" || f.content === "b")
        .map(([dest]) => dest);
      assertEquals(
        new Set(landed).size,
        2,
        `${h.key} is nested — both documents must survive at distinct paths, got ${
          landed.join(", ") || "neither"
        }`,
      );
    }
  }
});
