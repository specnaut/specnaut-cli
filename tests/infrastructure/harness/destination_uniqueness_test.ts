import { assert, assertThrows } from "@std/assert";
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
  assert(
    combinations === everyBundleOption().length * HARNESSES.length,
    `sweep covered ${combinations} harness×combination pairs, expected ${
      everyBundleOption().length * HARNESSES.length
    }`,
  );
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

Deno.test("a colliding pair of entries is refused by every harness", () => {
  // Two sub-documents owned by two different skills, with the SAME document
  // name. On a nested harness they land in different folders and coexist; on a
  // flat one they collapse onto one filename unless the owner prefix separates
  // them. This fixture is the shape that made the guard necessary.
  const collide: CoreBundle = [
    {
      category: "phase",
      name: "specnaut",
      suffix: "release.md",
      content: "a",
      executable: false,
    },
    {
      category: "phase",
      name: "specnaut",
      suffix: "release.md",
      content: "b",
      executable: false,
    },
  ] as ReadonlyArray<CoreEntry>;

  for (const h of HARNESSES) {
    assertThrows(
      () => h.mapBundle(collide, everyBundleOption()[0]),
      Error,
      undefined,
      `${h.key} accepted two entries at one destination — the guard is not wired ` +
        `into this adapter's write site`,
    );
  }
});
