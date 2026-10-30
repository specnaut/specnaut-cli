import { assert, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { flat, phase, rootAgents } from "./task_docs.ts";

/**
 * #630 — technical forks are settled by the expert seats, not put to the user.
 * The rule lives in plan.md step 6 ("Who decides", folded in from plan-audits.md
 * by spec 041); auto-chain.md and the always-loaded AGENTS.md block point at
 * it, and review.md applies it to the fix loop. Split out of
 * `chain_stops_test.ts` (cli#709).
 */
Deno.test("technical forks are decided by the expert seats, never asked (#630)", () => {
  // `plan-audits.md` was folded into `plan.md` (spec 041): the rule moved, the lock followed it.
  const plan = flat(phase("plan").content);
  assertStringIncludes(plan, "**Who decides — the seats, not the user.**");
  assertStringIncludes(plan, "**never asked**");
  // The tie-break between seats is stated, in order.
  assertStringIncludes(
    plan,
    "security, then maintainability, then performance, then speed of delivery",
  );
  // A performance seat joins when the plan has a hot path.
  assertStringIncludes(plan, "`performance-expert` too when the change has a hot path");
  assertStringIncludes(plan, "**A technical fork is never a question**");
  assertStringIncludes(plan, "**Nothing open → no stop**");
  assertStringIncludes(plan, "a new external service, vendor or cost");
  // The intent the seats decide against.
  assertStringIncludes(plan, "clean, SOLID, secure by default");

  const chain = flat(phase("auto-chain").content);
  assertStringIncludes(chain, "**only if something only the user can answer is open**");

  const review = phase("review").content;
  assertStringIncludes(review, "Choosing *between* technical fixes is never the user's call");

  const { content: agents } = rootAgents();
  assertStringIncludes(agents, "never put to a vote. Nothing open → no stop.");
  assertStringIncludes(agents, "**long-lived** software — clean, SOLID, secure by default");
});

Deno.test("the plan-time audits run on every plan, and each seat states its own questions", () => {
  // Security audit of spec 041: the slim brief must not make the audit optional, and the
  // questions that left `plan-audits.md` must live where the seat reads them.
  const plan = flat(phase("plan").content);
  assertStringIncludes(plan, "**They run on every plan, brief or full**");
  assertStringIncludes(plan, "`architect-expert` and `security-expert` on `plan.md`");
  const seat = (name: string) => {
    const e = CORE_BUNDLE.find((x) => x.category === "agent" && x.name === name);
    if (!e) throw new Error(`missing agent ${name}`);
    const text = flat(e.content);
    const at = text.indexOf("## Mode 3");
    assert(at >= 0, `${name} has no Mode 3`);
    return text.slice(at);
  };
  const questions: Record<string, string[]> = {
    "architect-expert": [
      "Is the decision table complete?",
      "Is each home the right home?",
      "What is the blast radius?",
      "Do the touched files hold their size?",
      "What would a reviewer find in this design three cycles from now?",
    ],
    "security-expert": [
      "Which new surface accepts input, and where does it stop?",
      "Who is allowed, and where is that decided?",
      "What identifiers and what bytes become reachable?",
      "What does this let an authenticated stranger do to somebody else's account?",
    ],
    "performance-expert": [
      "What grows with the data?",
      "What runs per request, or per item?",
      "What does the plan do at 100× today's set?",
    ],
  };
  for (const [name, qs] of Object.entries(questions)) {
    const mode3 = seat(name);
    assertStringIncludes(mode3, "Spawned by `phases/plan.md`", `${name} names its dispatcher`);
    let from = 0;
    for (const q of qs) {
      const at = mode3.indexOf(q, from);
      assert(at >= 0, `${name} Mode 3 lost, or reordered, "${q}"`);
      from = at;
    }
  }
  assertStringIncludes(seat("security-expert"), "crosses the threshold: <which>");
});
