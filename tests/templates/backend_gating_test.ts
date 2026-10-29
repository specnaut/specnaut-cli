import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";

/**
 * A backend-specific artefact must not ship to a project that chose a different
 * backend.
 *
 * `.specnaut/backlog.md` did. Its manifest entry carried no `backend` key while
 * 38 siblings — every backlog script among them — were gated, so it shipped
 * unconditionally. Its own opening lines describe the local backend ("Each task
 * is one file under `.specnaut/backlog/NNN-slug.md`"), which meant a project
 * whose lock reads `backlog_backend: github` had a local Markdown backlog index
 * created in its tree: a second, empty source of truth for data that lives on a
 * GitHub Project.
 *
 * A missing gate is invisible — the file simply appears, under "new files to
 * add", looking like any other addition. Nothing distinguishes "belongs here"
 * from "nobody said it didn't".
 */

type Entry = {
  category: string;
  name: string;
  suffix?: string;
  content: string;
  backend?: "local" | "github" | "gitlab" | null;
};

const ENTRIES = CORE_BUNDLE as unknown as Entry[];

/**
 * `category/name`, plus `/suffix` for a sub-document — `task` owns five
 * backlog docs, and an excuse for one must not excuse its siblings.
 */
const keyOf = (e: Entry) => `${e.category}/${e.name}${e.suffix ? `/${e.suffix}` : ""}`;

function find(predicate: (e: Entry) => boolean): Entry | undefined {
  return ENTRIES.find(predicate);
}

Deno.test("the markdown backlog index ships only to the local backend", () => {
  // The project's `.specnaut/backlog.md` index — not `task/backlog.md`, the
  // backlog verbs' document beside the `/task` router, which shares its name.
  const entry = find((e) => e.category === "spec-root" && e.suffix === "backlog.md");
  assert(entry, "the backlog index is no longer bundled — did it move?");
  assertEquals(
    entry.backend,
    "local",
    "a github/gitlab project must not receive a local Markdown backlog",
  );
});

Deno.test("every backlog script is gated, and none is gated to a backend it contradicts", () => {
  const scripts = ENTRIES.filter((e) => e.category === "backlog-script");
  assert(scripts.length > 0, "no backlog scripts in the bundle");
  for (const s of scripts) {
    assert(
      s.backend != null,
      `${s.category}/${s.name} ships to every backend — a backlog script cannot be backend-agnostic`,
    );
  }
});

/**
 * Entries that mention the local backend's on-disk layout and SHOULD ship
 * everywhere, each with the reason. Describing a backend is not the same as
 * being one: an agent or a skill has to tell the reader what all three look
 * like in order to route between them.
 *
 * An entry earns a line here by being documentation. One that CREATES local
 * state does not, whatever it says about itself.
 */
const DOCUMENTS_ALL_BACKENDS: Record<string, string> = {
  "skill/backlog-reference-contract":
    "defines how an item is named across every backend; the local path is one row of that table",
  "agent/product-owner": "owns the backlog lifecycle on all three backends",
  // `backlog-skill/board` until cli#683, when the backend sections moved from
  // the router into `task/backlog.md`.
  "backlog-doc/task/backlog.md":
    "the backlog verbs' document, rendered per backend at install time " +
    "rather than gated in the manifest; its parent-link table documents all three backends",
};

Deno.test("no ungated entry describes a single backend's storage layout", () => {
  // The signature of the defect: prose naming one backend's on-disk shape in a
  // file that ships to all of them. Narrow on purpose — a guard against the way
  // `.specnaut/backlog.md` slipped through, not a prose linter.
  const LOCAL_ONLY_SHAPE = ".specnaut/backlog/";
  const offenders = ENTRIES
    .filter((e) => e.backend == null)
    .filter((e) => typeof e.content === "string" && e.content.includes(LOCAL_ONLY_SHAPE))
    .map(keyOf)
    .filter((key) => !(key in DOCUMENTS_ALL_BACKENDS));

  assertEquals(
    offenders,
    [],
    "these ship to every backend while describing the local one's layout — " +
      "gate them in templates/manifest.json, or add a justified line to " +
      "DOCUMENTS_ALL_BACKENDS if they genuinely document all three",
  );
});

Deno.test("the allow-list has no dead entries", () => {
  // A justification for something that no longer matches is a claim nobody can
  // check. Same discipline as the removed-artefact guard.
  const live = new Set(
    ENTRIES
      .filter((e) => typeof e.content === "string" && e.content.includes(".specnaut/backlog/"))
      .map(keyOf),
  );
  assertEquals(
    Object.keys(DOCUMENTS_ALL_BACKENDS).filter((k) => !live.has(k)),
    [],
    "these are excused but no longer mention the local layout — drop them",
  );
});
