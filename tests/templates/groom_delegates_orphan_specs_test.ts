import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * The bundled `/loop` prompt promised that the grooming pass (`/board groom`
 * then, `/task groom` since cli#683) "flags orphan specs".
 * `groom.md` said the check was not its business and had moved. No line in it
 * told anyone to read the file it named, and `auto-chain.md` — believing
 * itself reachable — said to run the walk "from a grooming pass".
 *
 * Three documents, one scheduled loop advertising the check, and nothing that
 * executed it.
 *
 * The guard here has to survive a specific near-miss: `groom.md` ALREADY
 * contained the string `phases/auto-chain.md` before the fix, inside the
 * sentence disowning the work. A test asserting the filename appears would
 * have passed against the broken tree. What is asserted is the **instruction**,
 * and the count of checks is derived from the headings rather than trusted
 * from the prose.
 */

const CORE = fromFileUrl(new URL("../../templates/core/skills/", import.meta.url));
const GROOM = `${CORE}task/groom.md`;
const AUTO_CHAIN = `${CORE}task/phases/auto-chain.md`;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
};

Deno.test("groom: the orphan-spec check is an instruction, not a disclaimer", async () => {
  const src = await Deno.readTextFile(GROOM);

  // Naming the file is what the BROKEN version did. The imperative is the fix.
  assert(
    /\*\*Read `phases\/auto-chain\.md` and follow its "Orphan spec detection" section\.\*\*/
      .test(src),
    "groom.md no longer instructs reading auto-chain.md — a delegation that only " +
      "names the file is the disclaimer this ticket removed",
  );

  // And it must be a step of the pass, not an aside.
  assert(
    /^### \d+\. Orphan specs/m.test(src),
    "the orphan-spec delegation is not a numbered step of the grooming pass",
  );
});

Deno.test("groom: the delegation is gated on the project keeping specs locally", async () => {
  // `auto-chain.md` qualifies its own trigger on this condition. A caller that
  // ignored it would make that sentence false in the other direction.
  const src = await Deno.readTextFile(GROOM);
  const step = src.slice(src.search(/^### \d+\. Orphan specs/m));
  assertStringIncludes(step, ".specnaut/specs/");
});

Deno.test("groom: the walk is delegated, never copied", async () => {
  // The logic stays in one place. A second copy is the half that rots.
  const src = await Deno.readTextFile(GROOM);
  // The walk's own flag strings, at the address auto-chain.md spells them now
  // and at the one it spelled before cli#683 — a copy taken from either is a copy.
  for (
    const leaked of [
      "needs `/task tasks`",
      "needs `/task implement`",
      "needs `/specnaut tasks`",
      "needs `/specnaut implement`",
      "spec.md",
    ]
  ) {
    assert(
      !src.includes(leaked),
      `the orphan-spec walk was copied into groom.md (found ${leaked}) — delegate, do not duplicate`,
    );
  }
});

Deno.test("groom: the stated number of checks matches the steps that exist", async () => {
  // Derived, not pinned. The prose said "three" while four were intended; a
  // literal assertion on "four" would go stale the same way on the fifth.
  const src = await Deno.readTextFile(GROOM);
  const stated = src.match(/A grooming pass runs (\w+) independent checks/);
  assert(stated, "the count sentence is gone from groom.md");
  const claimed = NUMBER_WORDS[stated[1]];
  assert(claimed !== undefined, `unrecognised number word: "${stated[1]}"`);

  const steps = [...src.matchAll(/^### (\d+)\. /gm)].map((m) => Number(m[1]));
  assertEquals(
    claimed,
    steps.length,
    `groom.md claims ${stated[1]} checks and carries ${steps.length}`,
  );
  assertEquals(steps, steps.map((_, i) => i + 1), "the check steps are not numbered 1..N");
});

Deno.test("groom: the delegation target still exists", async () => {
  // A delegation to a section that has been renamed is the same outage with
  // extra steps, and nothing else in the suite reads this heading.
  const src = await Deno.readTextFile(AUTO_CHAIN);
  assertStringIncludes(src, "## Orphan spec detection");
});

Deno.test("auto-chain: its trigger sentence names a caller that exists", async () => {
  // It claimed to run "from a grooming pass" for as long as no grooming pass
  // reached it. The claim is now checkable, so check it.
  const auto = await Deno.readTextFile(AUTO_CHAIN);
  const sentence = auto.slice(auto.indexOf("Run it when asked to audit"));
  const named = sentence.match(/`(task\/groom\.md)`/);
  assert(named, "auto-chain.md does not name the caller its trigger sentence claims");

  const groom = await Deno.readTextFile(GROOM);
  assertStringIncludes(
    groom,
    "auto-chain.md",
    "auto-chain.md names groom.md as its caller, and groom.md does not call it",
  );
});

Deno.test("groom: the grooming pass does not reclaim ownership by running the check", async () => {
  // The ownership line stands: the walk lives in the pipeline's contract doc,
  // not in the grooming pass that calls it. Since cli#683 both sit under
  // `/task`, so the line is drawn between the two documents rather than two
  // skills — and both must keep saying so while the delegation exists, or the
  // next reader moves the logic to match the caller.
  const groom = (await Deno.readTextFile(GROOM)).replace(/\s+/g, " ");
  assertStringIncludes(groom, "Orphan **spec** detection is not owned here");

  // The router lists auto-chain.md as a contract doc of the chain — the side
  // that owns the walk.
  const taskSkill = await Deno.readTextFile(`${CORE}task/SKILL.md`);
  assertStringIncludes(taskSkill, "phases/auto-chain.md");
  assertStringIncludes(taskSkill, "**contract docs, not verbs**");
});
