import { assertEquals } from "@std/assert";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";
import { skillFolderName } from "../../src/infrastructure/harness/skill_folder.ts";

/**
 * A shipped file must not name a slash command the bundle does not emit.
 *
 * `specify-rules.mdc` advertised `/specnaut-backlog` to Cursor users. The
 * skill folder is named by `skillFolderName`, which had started emitting
 * `specnaut-board` — so the one file telling a Cursor user what to type named
 * a command that does not exist there.
 *
 * It survived a full rename sweep because the sweep matched `/backlog` and
 * this string is `/specnaut-backlog`: the same skill under the name a harness
 * gives it. Prose naming a *generated* identifier has to be checked against
 * the generator, not against the identifier's other spelling.
 *
 * Scoped to the `specnaut-` prefixed form on purpose. That form is produced
 * entirely by `skillFolderName`, so the valid set is derivable and the check
 * has no judgement in it. Bare `/task <verb>` is a subcommand, not a
 * folder, and harness built-ins like `/loop` are none of our business.
 */

type Entry = { category: string; name: string; content: unknown };

/**
 * Core AND harness-specific. The first version of this file scanned only
 * `CORE_BUNDLE` — and the defect it was written for lives in
 * `harness-specific/cursor/specify-rules.mdc`, so reintroducing that exact
 * line left the suite green. A guard that cannot see the file it was written
 * for is not a guard.
 */
const ENTRIES: Entry[] = [
  ...(CORE_BUNDLE as ReadonlyArray<Entry>).filter((e) => typeof e.content === "string"),
  ...Object.entries(HARNESS_STATIC).flatMap(([harness, files]) =>
    Object.entries(files)
      .filter(([, f]) => typeof f?.content === "string")
      .map(([dest, f]) => ({
        category: `harness:${harness}`,
        name: dest,
        content: f.content as unknown,
      }))
  ),
];

/**
 * Asks `skillFolderName` — the only thing that names these folders — rather
 * than mirroring its rule here: a mirror is a second spelling of the rule, and
 * it is the spelling that goes stale.
 */
function emittedNames(): Set<string> {
  const out = new Set<string>(["specnaut"]);
  for (const e of CORE_BUNDLE) {
    if (e.category === "skill" || e.category === "backlog-skill") {
      out.add(skillFolderName(e));
    } else if (e.category === "agent") {
      out.add(skillFolderName(e));
      // Claude keeps agents unprefixed in `.claude/agents/`, and the docs
      // reference them by that bare name.
      out.add(e.name);
    }
  }
  return out;
}

Deno.test("every `/specnaut-…` command a shipped file names is one the bundle emits", () => {
  const valid = emittedNames();
  const bad: string[] = [];

  for (const e of ENTRIES) {
    // The `/` must open a token, not sit inside a URL path: every false
    // positive in the first run was `.../repos/specnaut/specnaut-cli/...`,
    // where the slash follows a word character.
    for (const m of (e.content as string).matchAll(/(^|[^A-Za-z0-9.])\/(specnaut-[a-z0-9-]+)/gm)) {
      const token = m[2].replace(/-+$/, "");
      if (!valid.has(token)) bad.push(`${e.category}/${e.name} → /${token}`);
    }
  }

  assertEquals(
    [...new Set(bad)].sort(),
    [],
    "these name a command no harness emits — check the name against " +
      "skillFolderName, not against the skill's other spelling",
  );
});

Deno.test("the check is anchored to something that exists", () => {
  // A derived allow-set that came back empty would pass this file for any
  // input at all. Two spot-checks that the set is real.
  const valid = emittedNames();
  assertEquals(valid.has("specnaut"), true, "the router must be in the set");
  assertEquals(valid.has("specnaut-task"), true, "the task skill must be in the set");
  assertEquals(valid.has("specnaut-ship"), true, "the ship skill must be in the set");
  // Retired names must be gone — `backlog` before #571, `board` and the
  // audit skills since cli#683.
  for (
    const gone of [
      "specnaut-backlog",
      "specnaut-board",
      "specnaut-code-audit",
      "specnaut-sec-audit",
    ]
  ) {
    assertEquals(valid.has(gone), false, `${gone} is retired and must not be emitted`);
  }
});
