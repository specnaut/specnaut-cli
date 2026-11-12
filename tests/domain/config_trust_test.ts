import { assertEquals } from "@std/assert";
import {
  CONFIG_INPUTS,
  type ConfigFile,
  type ConfigSides,
  judgeConfig,
} from "../../src/domain/config_trust.ts";
import { REASON } from "../../src/domain/script_trust.ts";

/** One row of the config rule per test: the side that differs from a clean base, and its verdict. */

const file = (text: string): ConfigFile => ({
  kind: "file",
  bytes: new TextEncoder().encode(text),
});
const ABSENT: ConfigFile = { kind: "absent" };
const input = (cls: string) => CONFIG_INPUTS.find((i) => i.class === cls)!;

function judge(cls: string, over: Partial<ConfigSides>) {
  const base = file("x: 1\n");
  const sides = { tree: base, tip: base, mergeBase: base, ...over };
  const v = judgeConfig(input(cls), sides);
  return v.trusted ? "trusted" : v.reason;
}

Deno.test("the classes are the six inputs a branch controls, each at its path", () => {
  assertEquals(CONFIG_INPUTS.map((i) => `${i.class} ${i.path}`), [
    "workflow .specnaut/workflow.yml",
    "size-limits .specnaut/size-limits.yml",
    "boundaries .specnaut/boundaries.yml",
    "backlog-config .specnaut/backlog-config.yml",
    "linked-issue .specnaut/feature.json",
    "gates .specnaut/gates.yml",
  ]);
});

for (const cls of ["workflow", "size-limits", "boundaries", "gates"]) {
  Deno.test(`${cls}: the tree's bytes must be the tip's, one byte apart is untrusted`, () => {
    assertEquals(judge(cls, {}), "trusted");
    assertEquals(judge(cls, { tree: file("x: 2\n") }), REASON.differs);
    assertEquals(judge(cls, { tree: file("x: 1\r\n") }), REASON.differs);
  });
}

Deno.test("backlog-config: the columns grooming writes are the only lines not judged, so a column written beside it holds", () => {
  const base = file('repo: "acme/my-app"\nproject_number: 1\n');
  const sides = { tip: base, mergeBase: base };
  const columned = file(
    'repo: "acme/my-app"\nproject_number: 1\nintake_column: "Inbox"\nready_column: "Ready"\n',
  );
  assertEquals(judge("backlog-config", { ...sides, tree: columned }), "trusted");
  const moved = file('repo: "acme/other"\nproject_number: 1\n');
  assertEquals(judge("backlog-config", { ...sides, tree: moved }), REASON.differs);
  const twice = file('repo: "acme/my-app"\nrepo: "acme/other"\nproject_number: 1\n');
  assertEquals(judge("backlog-config", { ...sides, tree: twice }), REASON.differs);
});

Deno.test("backlog-config: a grooming line that is not one quoted value is refused, unjudged", () => {
  const base = file('repo: "acme/my-app"\nready_column: "Ready"\n');
  const sides = { tip: base, mergeBase: base };
  const judged = (text: string) => judge("backlog-config", { ...sides, tree: file(text) });
  assertEquals(judged('repo: "acme/my-app"\nready_column: "Doing"\n'), "trusted");
  assertEquals(
    judged('repo: "acme/my-app"\nready_column: "Ready\n'),
    "ready_column is not one quoted value",
  );
  assertEquals(
    judged('repo: "acme/my-app"\nready_column: Ready\n'),
    "ready_column is not one quoted value",
  );
  assertEquals(
    judged('repo: "acme/my-app"\nready_column: "Ready"\nready_column: "Done"\n'),
    "a column key is given twice",
  );
  assertEquals(
    judged('repo: "acme/my-app"\nready_column: "Ready"\r---\n'),
    "a carriage return inside a line",
  );
  assertEquals(judged('repo: "acme/my-app"\r\nready_column: "Ready"\n'), REASON.differs);
});

Deno.test("backlog-config: a remote block turned off is judged, like any line grooming does not write", () => {
  const on = file('repo: "acme/my-app"\nremote:\n  enabled: true\n');
  const off = file('repo: "acme/my-app"\nremote:\n  enabled: false\n');
  assertEquals(judge("backlog-config", { tip: on, mergeBase: on, tree: off }), REASON.differs);
  const gone = file('repo: "acme/my-app"\n');
  assertEquals(judge("backlog-config", { tip: on, mergeBase: on, tree: gone }), REASON.differs);
});

Deno.test("backlog-config: every key that names the tracker is judged, on every backend", () => {
  const github = file('repo: "acme/my-app"\nproject_number: 1\n');
  const renumbered = file('repo: "acme/my-app"\nproject_number: 2\n');
  assertEquals(
    judge("backlog-config", { tip: github, mergeBase: github, tree: renumbered }),
    REASON.differs,
  );
  const cloud = file("api_url: https://api.example.com\nproject_key: acme\n");
  const elsewhere = file("api_url: https://other.example.com\nproject_key: acme\n");
  assertEquals(
    judge("backlog-config", { tip: cloud, mergeBase: cloud, tree: elsewhere }),
    REASON.differs,
  );
  const gitlab = file("host: https://gitlab.example.com\nproject_id: 7\n");
  for (
    const edited of [
      "host: https://other.example.com\nproject_id: 7\n",
      "host: https://gitlab.example.com\nproject_id: 8\n",
    ]
  ) {
    assertEquals(
      judge("backlog-config", { tip: gitlab, mergeBase: gitlab, tree: file(edited) }),
      REASON.differs,
    );
  }
});

Deno.test("linked-issue: only the link is judged, so a delivery marked partial holds", () => {
  const base = file('{ "feature_directory": "specs/001-x", "linked_issue": 42 }\n');
  const sides = { tip: base, mergeBase: base };
  const partial = file(
    '{ "feature_directory": "specs/001-x", "linked_issue": 42, "delivery": "partial" }\n',
  );
  assertEquals(judge("linked-issue", { ...sides, tree: partial }), "trusted");
  const other = file('{ "feature_directory": "specs/001-x", "linked_issue": 7 }\n');
  assertEquals(judge("linked-issue", { ...sides, tree: other }), REASON.differs);
  const twice = file('{ "linked_issue": 42, "linked_issue": 7 }\n');
  assertEquals(judge("linked-issue", { ...sides, tree: twice }), "linked_issue is given twice");
});

Deno.test("linked-issue: a file its readers could read two ways is refused, never compared", () => {
  const base = file('{ "linked_issue": 42 }\n');
  const sides = { tip: base, mergeBase: base };
  const escaped = file('{ "linked_issue": 42, "linked\\u005fissue": 7 }\n');
  assertEquals(
    judge("linked-issue", { ...sides, tree: escaped }),
    "linked_issue is written escaped",
  );
  const vtab = file('{ "linked_issue":\v42 }\n');
  assertEquals(
    String(judge("linked-issue", { ...sides, tree: vtab })).startsWith("does not parse"),
    true,
  );
  const spaced = file('{\n  "linked_issue" :  42\n}\n');
  assertEquals(judge("linked-issue", { ...sides, tree: spaced }), "trusted");
});

Deno.test("absent on both sides is trusted; on one side only, the side is named", () => {
  assertEquals(judge("gates", { tree: ABSENT, tip: ABSENT, mergeBase: ABSENT }), "trusted");
  assertEquals(judge("gates", { tree: ABSENT }), REASON.missing);
  assertEquals(judge("gates", { tip: ABSENT, mergeBase: ABSENT }), REASON.notOnBase);
});

Deno.test("a tree that holds the merge base's value while the tip moved is behind, not edited", () => {
  assertEquals(judge("workflow", { tip: file("x: 2\n") }), REASON.behind);
  assertEquals(judge("workflow", { tip: ABSENT }), REASON.behind);
});

Deno.test("a path that is not a regular file is refused on either side, never read", () => {
  assertEquals(judge("workflow", { tree: { kind: "refused", why: REASON.link } }), REASON.link);
  assertEquals(
    judge("workflow", { tip: { kind: "refused", why: "a link" } }),
    REASON.baseNotRegular,
  );
});
