import { assert } from "@std/assert";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../src/templates_bundle.ts";
import { retiredAddresses } from "./retired_table.ts";

/**
 * Every `/specnaut <verb>`, `/task <verb>` and `/ship <verb>` a shipped document
 * tells someone to run resolves: to a verb its router routes, or to a row of
 * the `/specnaut` router's "Retired addresses" section, which answers it with a
 * one-line notice. Anything else is an instruction that leads nowhere — what
 * spec 034 found in five skills and four agents once the audit phases were
 * gone, and what cli#683's split of `/specnaut` into `/task` would otherwise
 * have left behind in every document that named a pipeline phase.
 *
 * Derived from the bundle, not from a list of names: a list would be a registry
 * kept forever, and it would only catch the names someone remembered. The
 * retired rows come from the section itself (`retired_table.ts`); whether a
 * retired address may be named at all is `retired_addresses_test.ts`'s lock.
 */

const ROUTERS = ["specnaut", "task", "ship"] as const;
type Router = typeof ROUTERS[number];

const documents: Array<{ where: string; content: string; isStatic: boolean }> = [
  ...CORE_BUNDLE.map((e) => ({
    where: `${e.category}:${e.name}/${e.suffix ?? ""}`,
    content: e.content,
    isStatic: false,
  })),
  ...Object.entries(HARNESS_STATIC).flatMap(([h, files]) =>
    Object.entries(files).map(([dest, f]) => ({
      where: `${h}:${dest}`,
      content: f.content,
      isStatic: true,
    }))
  ),
];

function routerOf(name: Router): string {
  const e = CORE_BUNDLE.find((x) =>
    (x.category === "skill" || x.category === "backlog-skill") && x.name === name
  );
  if (!e) throw new Error(`no bundled router for /${name}`);
  return e.content;
}

/** The documents a router owns that actually ship, by their path under its folder. */
function shippedDocs(name: Router): Set<string> {
  return new Set(
    CORE_BUNDLE.filter((e) => e.name === name && e.suffix !== null).map((e) =>
      e.category === "phase" ? `phases/${e.suffix}` : `${e.suffix}`
    ),
  );
}

/**
 * What a router routes: the first column of its verb table, and only where the
 * document that row points at actually ships. Not every document under
 * `phases/` — `merge-squash`, `plan-audits` and the other contract docs sit
 * there too, and the router answers them with its table, not a verb.
 *
 * `/ship` routes by path rather than by a verb table; its verbs are the phase
 * documents it ships (`tag`, `release`).
 */
function routedBy(name: Router): Set<string> {
  const shipped = shippedDocs(name);
  if (name === "ship") {
    return new Set(
      [...shipped].filter((d) => d.startsWith("phases/")).map((d) =>
        d.slice("phases/".length).replace(/\.md$/, "")
      ),
    );
  }
  const out = new Set<string>();
  for (const line of routerOf(name).split("\n")) {
    const m = line.match(/^\| `([a-z][a-z-]*)[^`]*`(?: _[^|]*_)? \| `([a-z0-9/-]+\.md)` \|/);
    if (m && shipped.has(m[2])) out.add(m[1]);
  }
  return out;
}

const routed: Record<Router, Set<string>> = {
  specnaut: routedBy("specnaut"),
  task: routedBy("task"),
  ship: routedBy("ship"),
};

/**
 * What the `/specnaut` router answers with a notice, per router: the retired
 * rows that name a verb (`/specnaut plan`, `/specnaut brainstorm`). A whole
 * retired skill (`/board`) is not a mention of any of the three routers.
 */
const retired = new Set(
  retiredAddresses().filter((a) => a.verb !== null).map((a) => `${a.skill} ${a.verb}`),
);

/**
 * `/<router> <verb>`, the plugin's `/specnaut-plugin:<router> <verb>` included.
 * Leading `--flags` are skipped, as the router strips them. A version
 * (`/ship v7.2.0`, `/ship 7.2.0`) is the `/ship` input, not a verb.
 *
 * In Markdown only inside a code span: prose says "the `/task` router", and a
 * word after the command is a verb only where the text is quoting a command. A
 * script has no prose, so there every mention counts.
 */
function mentions(where: string, content: string): Array<{ router: Router; verb: string }> {
  const script = /\.(sh|ps1|js|ts)$/.test(where);
  const body = "\\/(?:specnaut-plugin:)?(specnaut|task|ship) (?:--[a-z-]+ )*([a-z][a-z0-9.-]*)";
  const re = script ? new RegExp(body, "g") : new RegExp("`" + body + "[^`]*`", "g");
  return [...content.matchAll(re)]
    .filter(([, , verb]) => !/^v?\d/.test(verb))
    .map(([, router, verb]) => ({ router: router as Router, verb: verb.replace(/[.-]+$/, "") }));
}

Deno.test("the routers and the retired section were found, and read narrowly", () => {
  assert(routed.task.has("plan") && routed.task.has("review"), "no pipeline verb read from /task");
  assert(routed.task.has("groom") && routed.task.has("edit"), "no backlog verb read from /task");
  assert(!routed.task.has("merge-squash"), "a contract doc read as a routed verb");
  assert(routed.specnaut.has("upgrade") && !routed.specnaut.has("plan"), "/specnaut read wrongly");
  assert(routed.ship.has("tag") && routed.ship.has("release"), "no /ship verb read");
  assert(
    retired.has("specnaut plan") && retired.has("specnaut brainstorm"),
    "no retired row read",
  );
  // A successor or a bare axis must never resolve as retired.
  assert(!retired.has("task plan") && !retired.has("specnaut security"), "retired reads too wide");
});

Deno.test("every /specnaut, /task and /ship <verb> a shipped document names resolves", () => {
  const dangling: string[] = [];
  const seen = new Set<string>();
  let total = 0;
  const from = { script: 0, static: 0 };
  const per: Record<Router, number> = { specnaut: 0, task: 0, ship: 0 };
  for (const { where, content, isStatic } of documents) {
    for (const { router, verb } of mentions(where, content)) {
      total++;
      per[router]++;
      if (/\.(sh|ps1|js|ts)$/.test(where)) from.script++;
      if (isStatic) from.static++;
      seen.add(`${router} ${verb}`);
      if (!routed[router].has(verb) && !retired.has(`${router} ${verb}`)) {
        dangling.push(`${where}: /${router} ${verb}`);
      }
    }
  }
  // Non-vacuity: a regex that stopped matching would report "nothing dangles".
  assert(total > 20 && seen.has("task plan") && seen.has("task merge"), `only ${total} read`);
  // Per router and per source, so a scan gone blind to one fails alone.
  for (const r of ROUTERS) assert(per[r] > 0, `no /${r} mention read`);
  assert(from.script > 0, "no mention read from a script — the script scan read nothing");
  assert(from.static > 0, "no mention read from a harness static — the static scan read nothing");
  assert(dangling.length === 0, `mentions of a verb nothing answers:\n${dangling.join("\n")}`);
});

Deno.test("no shipped document carries the retired upstream's attribution", () => {
  const hits = documents.filter((d) => /superpowers/i.test(d.content)).map((d) => d.where);
  assert(hits.length === 0, `still attributed:\n${hits.join("\n")}`);
});
