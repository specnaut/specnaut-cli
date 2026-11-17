import { assertEquals } from "@std/assert";
import {
  candidateRows,
  MAX_CANDIDATE_ROWS,
  routedVerbs,
  rowVerb,
  verbRowDrops,
} from "../../src/domain/router_verb_rows.ts";

/**
 * The rows of a router's `## Verbs` table a supersede may drop (cli#803): a
 * row routing a verb the bundled table also routes, written as no bundled
 * row is. Synthetic routers; the verbs are whatever the tables say.
 */

const BUNDLED = [
  "# Router",
  "## Verbs",
  "| Verb | Reference | One-liner |",
  "| :--- | :--- | :--- |",
  "| `list` | `backlog.md` | Backlog overview |",
  "| `kanban [--no-open]` | `backlog.md` | Open the board |",
  "## Routing",
  "| `kanban` | elsewhere | not a verb row: past the section |",
].join("\n");

const LOCAL_ROW = "| `kanban` | `../board/SKILL.md` | Our own board |";
const withRow = (row: string) =>
  BUNDLED.replace("| `kanban [--no-open]` | `backlog.md` | Open the board |", row);

Deno.test("a row's verb is its first cell's first word, backticks dropped", () => {
  assertEquals(rowVerb("| `close <id> [--not-planned]` | x |"), "close");
  assertEquals(rowVerb("| kanban | x |"), "kanban");
  assertEquals(rowVerb("  | `<id>` | x |"), "<id>");
  assertEquals(rowVerb("| :--- | :--- |"), null);
  assertEquals(rowVerb("|  | x |"), null);
  assertEquals(rowVerb("not a row"), null);
});

Deno.test("routedVerbs reads the `## Verbs` rows only", () => {
  assertEquals([...routedVerbs(BUNDLED)], ["Verb", "list", "kanban"]);
  assertEquals([...routedVerbs("# Notes\n| `kanban` | x |")], []);
});

Deno.test("a local row for a verb the bundle routes is a candidate; a bundled line is not", () => {
  const disk = withRow(LOCAL_ROW);
  assertEquals(candidateRows(disk, BUNDLED), [5]);
  assertEquals(candidateRows(BUNDLED, BUNDLED), [], "the bundled rows themselves are no edit");
});

Deno.test("a row for a verb the bundle does not route is never a candidate", () => {
  const disk = withRow("| `deploy` | `../deploy/SKILL.md` | Ship it |");
  assertEquals(candidateRows(disk, BUNDLED), []);
});

Deno.test("only the `## Verbs` section is read, and a file without one has no candidate", () => {
  const disk = BUNDLED.replace("not a verb row: past the section", "edited past the section");
  assertEquals(candidateRows(disk, BUNDLED), []);
  assertEquals(candidateRows("# Notes\n| `kanban` | x |", "# Notes\n| `kanban` | y |"), []);
});

Deno.test("every drop is tried, fewest rows first", () => {
  const disk = withRow(LOCAL_ROW).replace("| Backlog overview |", "| An older wording |");
  const drops = [...verbRowDrops(disk, BUNDLED)].map((d) => d.dropped);
  assertEquals(drops, [
    ["| `list` | `backlog.md` | An older wording |"],
    [LOCAL_ROW],
    ["| `list` | `backlog.md` | An older wording |", LOCAL_ROW],
  ]);
  const first = verbRowDrops(disk, BUNDLED).next().value!;
  assertEquals(first.text.split("\n").length, disk.split("\n").length - 1);
});

Deno.test("with three candidates, every single row is tried before any pair", () => {
  const table = (w: string) => ["a", "b", "c"].map((v) => `| \`${v}\` | ${w} |`).join("\n");
  const sizes = [
    ...verbRowDrops(`## Verbs\n${table("local")}\n`, `## Verbs\n${table("shipped")}\n`),
  ]
    .map((d) => d.dropped.length);
  assertEquals(sizes, [1, 1, 1, 2, 2, 2, 3]);
});

Deno.test("past MAX_CANDIDATE_ROWS no drop is offered", () => {
  const verbs = Array.from({ length: MAX_CANDIDATE_ROWS + 1 }, (_, i) => `v${i}`);
  const table = (one: string) => verbs.map((v) => `| \`${v}\` | ${one} |`).join("\n");
  const [bundled, disk] = ["shipped", "local"].map((w) => `## Verbs\n${table(w)}\n`);
  assertEquals(candidateRows(disk, bundled).length, MAX_CANDIDATE_ROWS + 1);
  assertEquals([...verbRowDrops(disk, bundled)], []);
  const fewer = disk.replace("| `v0` | local |", "| `v0` | shipped |");
  assertEquals([...verbRowDrops(fewer, bundled)].length, 2 ** MAX_CANDIDATE_ROWS - 1);
});
