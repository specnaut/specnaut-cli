import { assertEquals } from "@std/assert";
import { trustLine, trustOf } from "../../src/domain/review_trust.ts";

const HEAD = "a".repeat(40);
const facts = (over: Record<string, unknown> = {}) => ({
  authorAssociation: "MEMBER",
  headRefOid: HEAD,
  isCrossRepository: false,
  ...over,
});

Deno.test("a team member's PR, from this repository, at the head reviewed, is trusted", () => {
  for (const authorAssociation of ["OWNER", "MEMBER", "COLLABORATOR"]) {
    assertEquals(trustOf(facts({ authorAssociation }), HEAD), { trusted: true }, authorAssociation);
  }
  assertEquals(trustLine({ trusted: true }), "trusted");
});

Deno.test("every other association is untrusted, named when it reads as one", () => {
  const cases: [unknown, string][] = [
    ["CONTRIBUTOR", "the author's association is CONTRIBUTOR, not a team member's"],
    [
      "FIRST_TIME_CONTRIBUTOR",
      "the author's association is FIRST_TIME_CONTRIBUTOR, not a team member's",
    ],
    ["NONE", "the author's association is NONE, not a team member's"],
    ["MANNEQUIN", "the author's association is MANNEQUIN, not a team member's"],
    ["member", "the author's association is not one the forge names"],
    ["MEMBER\u001b[2J", "the author's association is not one the forge names"],
    [null, "the author's association is not one the forge names"],
    [["MEMBER"], "the author's association is not one the forge names"],
  ];
  for (const [authorAssociation, why] of cases) {
    assertEquals(trustOf(facts({ authorAssociation }), HEAD), { trusted: false, why });
  }
});

Deno.test("a head that moved since, or one the forge does not name, is untrusted", () => {
  const moved = "b".repeat(40);
  assertEquals(trustOf(facts({ headRefOid: moved }), HEAD), {
    trusted: false,
    why: `the head moved: the PR's head is ${moved}, not ${HEAD}`,
  });
  for (const headRefOid of [undefined, "HEAD", HEAD.toUpperCase(), 7]) {
    assertEquals(trustOf(facts({ headRefOid }), HEAD), {
      trusted: false,
      why: "the forge names no head commit for the PR",
    });
  }
});

Deno.test("a head in another repository, or one the forge does not place, is untrusted", () => {
  assertEquals(trustOf(facts({ isCrossRepository: true }), HEAD), {
    trusted: false,
    why: "the head lives in another repository, where people outside the team can push",
  });
  for (const isCrossRepository of [undefined, "false", 0, null]) {
    assertEquals(trustOf(facts({ isCrossRepository }), HEAD), {
      trusted: false,
      why: "the forge does not say which repository the head lives in",
    });
  }
});

Deno.test("what the forge said is untrusted when it is not a PR's facts", () => {
  for (const said of [null, undefined, "x", [], 7]) {
    assertEquals(trustOf(said, HEAD), { trusted: false, why: "the forge named no such PR" });
  }
  assertEquals(trustLine({ trusted: false, why: "no" }), "untrusted no");
});
