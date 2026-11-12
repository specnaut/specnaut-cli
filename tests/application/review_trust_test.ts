import { assertEquals } from "@std/assert";
import { decideTrust } from "../../src/application/review_trust.ts";

const HEAD = "a".repeat(40);
const MEMBER = { authorAssociation: "MEMBER", headRefOid: HEAD, isCrossRepository: false };

/** A forge that describes every PR as `facts`; the PRs asked for, in `asked`. */
const forge = (facts: unknown, asked: number[] = []) => ({
  pullRequest: (n: number) => Promise.resolve(void asked.push(n)).then(() => facts),
});

Deno.test("the forge is asked about the PR named, and its facts decide", async () => {
  const asked: number[] = [];
  assertEquals(await decideTrust(forge(MEMBER, asked), "#12", HEAD), { trusted: true });
  assertEquals(asked, [12]);
  const outside = { ...MEMBER, authorAssociation: "NONE" };
  assertEquals((await decideTrust(forge(outside), "12", HEAD)).trusted, false);
});

Deno.test("a PR or a head that is not one is untrusted, and the forge is not asked", async () => {
  const cases: [string, string, string][] = [
    ["origin/topic", HEAD, "not a PR number: origin/topic"],
    ["012", HEAD, "not a PR number: 012"],
    ["12", "HEAD", "the head is not a full commit id: HEAD"],
    ["12", "", "the head is not a full commit id: "],
  ];
  for (const [pr, head, why] of cases) {
    const asked: number[] = [];
    assertEquals(await decideTrust(forge(MEMBER, asked), pr, head), { trusted: false, why });
    assertEquals(asked, [], pr);
  }
});

Deno.test("a forge that cannot be read is untrusted, naming why", async () => {
  const down = { pullRequest: () => Promise.reject(new Error("gh: not logged in")) };
  assertEquals(await decideTrust(down, "12", HEAD), {
    trusted: false,
    why: "the forge could not be read: gh: not logged in",
  });
});
