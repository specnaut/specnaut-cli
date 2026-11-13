import { assertEquals } from "@std/assert";
import { CONFIG_INPUTS, type ConfigFile, judgeConfig } from "../../src/domain/config_trust.ts";
import { REASON } from "../../src/domain/script_trust.ts";

/**
 * `feature.json`'s link, judged on the raw text its line-wise sed readers match: one
 * `"linked_issue"` literal, and the token after its colon, compared as written.
 */

const file = (text: string): ConfigFile => ({
  kind: "file",
  bytes: new TextEncoder().encode(text),
});
const LINK = CONFIG_INPUTS.find((i) => i.class === "linked-issue")!;

function judge(tree: string, base = '{ "linked_issue": 42 }\n') {
  const v = judgeConfig(LINK, { tree: file(tree), tip: file(base), mergeBase: file(base) });
  return v.trusted ? "trusted" : v.reason;
}

Deno.test("linked-issue: a key whose escaped tail spells the link is a second raw key", () => {
  assertEquals(
    judge('{ "linked_issue": 42, "x\\"linked_issue": 7 }\n'),
    "linked_issue is given twice",
  );
  assertEquals(
    judge('{ "x\\"linked_issue": 7, "linked_issue": 42 }\n'),
    "linked_issue is given twice",
  );
});

Deno.test("linked-issue: 1e1 is not 10, a token the sed readers take apart is refused", () => {
  const ten = '{ "linked_issue": 10 }\n';
  assertEquals(judge(ten, ten), "trusted");
  assertEquals(judge('{ "linked_issue": 1e1 }\n', ten), "linked_issue is not null or a number");
});

Deno.test("linked-issue: only null or a whole number from 1 is a token, and it is compared as written", () => {
  for (const token of ['"42"', "042", "-1", "0", "42.0", "true", "[42]"]) {
    const base = `{ "linked_issue": ${token} }\n`;
    assertEquals(judge(base, base), "linked_issue is not null or a number", token);
  }
  assertEquals(judge('{ "linked_issue": null }\n', '{ "linked_issue": null }\n'), "trusted");
  assertEquals(judge('{ "linked_issue": null }\n'), REASON.differs);
  assertEquals(judge('{ "linked_issue": 42}\n'), "trusted");
});

Deno.test("linked-issue: a key with no value on its own line is refused, as sed reads none", () => {
  assertEquals(judge('{ "linked_issue"\n: 42 }\n'), "linked_issue is not null or a number");
});

Deno.test("linked-issue: a link jq reads elsewhere than the raw key is refused", () => {
  assertEquals(
    judge('{ "x": { "linked_issue": 42 } }\n'),
    "linked_issue is not read the same way by its readers",
  );
});

Deno.test("linked-issue: no key on either side is the same link", () => {
  const none = '{ "feature_directory": "specs/001-x" }\n';
  assertEquals(judge(none, none), "trusted");
  assertEquals(judge(none), REASON.differs);
});
