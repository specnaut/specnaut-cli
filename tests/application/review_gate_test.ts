import { assertEquals, assertStringIncludes } from "@std/assert";
import { CHECK_PATH, gateReview } from "../../src/application/review_gate.ts";
import type { GrantedPass, ReviewPass } from "../../src/application/review_ports.ts";
import type { CheckoutOutcome } from "../../src/application/verify_checkout.ts";
import type { CheckoutState } from "../../src/domain/review_gate.ts";

/** A pass that records what the gate did with it. */
function pass(said: string[]): ReviewPass {
  return {
    grant: (tip, at, session) =>
      Promise.resolve(void said.push(`grant ${tip} ${session}${at === JUDGED ? "" : " ?"}`)),
    revoke: () => Promise.resolve(void said.push("revoke")),
    take: () => Promise.reject(new Error("the gate never takes a pass")),
  };
}

const TIP = "a".repeat(40);
const JUDGED: CheckoutState = { head: "b".repeat(40), ref: "refs/heads/topic", reflog: "c0" };
const checkout = () => Promise.resolve(JUDGED);
const START = "specnaut review start 12";

Deno.test("a command that starts no review is not gated: nothing is checked, and any pass goes", async () => {
  const said: string[] = [];
  const verify = () => Promise.reject(new Error("not reached"));
  for (const command of ["git status", null]) {
    const outcome = await gateReview({ verify, checkout, pass: pass(said) }, {
      sessionId: "s",
      command,
    });
    assertEquals(outcome, { kind: "not_gated" });
  }
  assertEquals(said, ["revoke", "revoke"]);
});

Deno.test("a pass lives only until the next command: one that starts no review leaves none", async () => {
  let held: GrantedPass | null = null;
  const memory: ReviewPass = {
    grant: (baseTip, at, session) =>
      Promise.resolve(void (held = { granted: 1, baseTip, checkout: at, session })),
    revoke: () => Promise.resolve(void (held = null)),
    take: () => Promise.resolve(held).finally(() => held = null),
  };
  const verify = () => Promise.resolve<CheckoutOutcome>({ kind: "trusted", baseTip: TIP });
  await gateReview({ verify, checkout, pass: memory }, {
    sessionId: "s",
    command: "echo review start",
  });
  await gateReview({ verify, checkout, pass: memory }, {
    sessionId: "s",
    command: "specnaut review --force start 12",
  });
  assertEquals(await memory.take(), null);
});

Deno.test("a start is checked for the session the hook names, and a holding checkout leaves a pass", async () => {
  const said: string[] = [];
  const asked: string[] = [];
  const verify = (id: string) => {
    asked.push(id);
    return Promise.resolve<CheckoutOutcome>({ kind: "trusted", baseTip: TIP });
  };
  const outcome = await gateReview({ verify, checkout, pass: pass(said) }, {
    sessionId: "s-9",
    command: START,
  });
  assertEquals(outcome.kind, "trusted");
  assertEquals(asked, ["s-9"]);
  assertEquals(said, ["revoke", `grant ${TIP} s-9`], "the pass names the session judged");
});

Deno.test("a gated command removes any pass, then reads the checkout its check is taken on, then checks", async () => {
  const said: string[] = [];
  const verify = () =>
    Promise.resolve(void said.push("verify")).then((): CheckoutOutcome => ({
      kind: "trusted",
      baseTip: TIP,
    }));
  const read = () => Promise.resolve(void said.push("checkout")).then(() => JUDGED);
  await gateReview({ verify, checkout: read, pass: pass(said) }, {
    sessionId: "s",
    command: START,
  });
  assertEquals(said, ["revoke", "checkout", "verify", `grant ${TIP} s`]);
});

Deno.test("a checkout that does not hold removes any pass, and so does no session id", async () => {
  const said: string[] = [];
  const restart: CheckoutOutcome = { kind: "restart", reasons: [], advice: "restart" };
  const asked: string[] = [];
  const verify = (id: string) => Promise.resolve(void asked.push(id)).then(() => restart);
  await gateReview({ verify, checkout, pass: pass(said) }, { sessionId: null, command: START });
  assertEquals(asked, [""]);
  assertEquals(said, ["revoke"]);
});

Deno.test("a check that throws, or a checkout that cannot be read, is a refusal naming why, never a pass", async () => {
  const trusted = () => Promise.resolve<CheckoutOutcome>({ kind: "trusted", baseTip: TIP });
  const lstat = () => Promise.reject(new Deno.errors.PermissionDenied("EACCES: lstat"));
  for (const [verify, read] of [[lstat, checkout], [trusted, lstat]] as const) {
    const said: string[] = [];
    const outcome = await gateReview({ verify, checkout: read, pass: pass(said) }, {
      sessionId: "s",
      command: START,
    });
    assertEquals(outcome.kind, "restart");
    if (outcome.kind !== "restart") return;
    assertEquals(outcome.reasons[0].path, CHECK_PATH);
    assertStringIncludes(outcome.reasons[0].reason, "could not finish: EACCES: lstat");
    assertEquals(said, ["revoke"]);
  }
});
