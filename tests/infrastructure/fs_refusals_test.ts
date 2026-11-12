import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import * as refusals from "../../src/infrastructure/fs_refusals.ts";

/**
 * Every refusal builder shows the paths it names through `terminalText` (cli#776).
 * A path comes from the repository — a lock key, a link's target — and a refusal
 * reaches the user's terminal, so a raw escape sequence in one is the repository
 * writing to that terminal. One case per builder, every path argument hostile.
 */

/** Raw C0, DEL and C1 controls, and the format characters `terminalText` escapes too. */
// deno-lint-ignore no-control-regex
const RAW = /[\x00-\x08\x0b-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩]/;

const hostile = (what: string) => `/p/${what}\x1b[2J\x07\x9b‮`;
const [root, abs, other] = [hostile("root"), hostile("abs"), hostile("other")];

/** Each case, keyed by the export it calls and what it builds. */
const builders: Record<string, () => Error> = {
  "refusalFor leaves": () => refusals.refusalFor(root, abs, { kind: "leaves", resolved: other }),
  "refusalFor unwalkable": () =>
    refusals.refusalFor(root, abs, { kind: "unwalkable", missing: other }),
  "refusalFor loop": () => refusals.refusalFor(root, abs, { kind: "loop" }),
  "projectDirectoryRefusal": () => refusals.projectDirectoryRefusal(root, abs),
  "linkedStagingRefusal": () => refusals.linkedStagingRefusal(root, abs),
  "stagedEntryRefusal": () => refusals.stagedEntryRefusal(root, abs, other, "read"),
};

Deno.test("every refusal builder fs_refusals.ts exports has a case below", () => {
  // A sweep, not a list: a builder added later is caught here, not in a review.
  const isClass = (v: unknown) => typeof v === "function" && /^class\b/.test(String(v));
  const exported = Object.entries(refusals).filter(([, v]) =>
    typeof v === "function" && !isClass(v)
  );
  const covered = new Set(Object.keys(builders).map((k) => k.split(" ")[0]));
  assertEquals(exported.map(([name]) => name).sort(), [...covered].sort());
});

for (const [name, build] of Object.entries(builders)) {
  Deno.test(`the ${name} refusal carries no raw control or format character`, () => {
    const { message } = build();
    assert(!RAW.test(message), `raw character in: ${JSON.stringify(message)}`);
    // Shown escaped, not dropped: the user still sees which path was refused.
    assertStringIncludes(message, "/p/abs\\u001b[2J\\u0007\\u009b\\u202e");
  });
}
