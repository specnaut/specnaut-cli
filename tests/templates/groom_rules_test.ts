import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { FULL_BODY, RULES, type Run, run } from "./groom_sandbox.ts";

/**
 * `groom-rules.sh` — the rule set, fed normalised records directly. Each
 * assertion is on what the script decided; none restates the rule.
 */

type Rec = {
  item: string;
  body: string;
  sizes: string[];
  priorities: string[];
  status: string;
  comments: string[] | null;
  state: "open" | "closed";
  closed_reason: string;
};

function rec(over: Partial<Rec> = {}): Rec {
  return {
    item: "42",
    body: FULL_BODY,
    sizes: ["M"],
    priorities: ["P1"],
    status: "Ready",
    comments: [],
    state: "open",
    closed_reason: "",
    ...over,
  };
}

function rules(records: unknown[] | string, args: string[] = []): Promise<Run> {
  const stdin = typeof records === "string"
    ? records
    : records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  return run("bash", [RULES, ...args], { stdin });
}

Deno.test("rules: a complete item prints nothing and exits 0", async () => {
  const r = await rules([rec()]);
  assertEquals([r.code, r.stdout], [0, ""], r.stderr);
});

for (const heading of ["Why", "Acceptance criteria", "Out of scope"]) {
  Deno.test(`rules: a body without ## ${heading} is incomplete`, async () => {
    const body = FULL_BODY.replace(`## ${heading}\n`, "");
    const r = await rules([rec({ body })]);
    assertEquals(r.code, 1, r.stderr);
    assertStringIncludes(r.stdout, `#42: missing ## ${heading}`);
  });
}

Deno.test("rules: a heading with nothing under it is not a section", async () => {
  const body = FULL_BODY.replace("CSV dialects.\n", "");
  const r = await rules([rec({ body })]);
  assertEquals(r.code, 1);
  assertStringIncludes(r.stdout, "## Out of scope");
  // ...and a `###` sub-heading is content, not the end of a section.
  const sub = FULL_BODY.replace("- [ ] the export pages", "### Paging\n- [ ] pages");
  assertEquals((await rules([rec({ body: sub })])).code, 0);
});

Deno.test("rules: size — none, two values, and a value off the scale", async () => {
  let r = await rules([rec({ sizes: [] })]);
  assertEquals(r.code, 1);
  assertStringIncludes(r.stdout, "size (none)");

  r = await rules([rec({ sizes: ["M", "L"] })]);
  assertEquals(r.code, 1);
  assertStringIncludes(r.stdout, "size (2 values: L, M)");

  r = await rules([rec({ sizes: ["XXL"] })]);
  assertEquals(r.code, 1);
  assertStringIncludes(r.stdout, "size (XXL is not one of XS S M L XL)");

  // The same value on two surfaces is one size, not two.
  r = await rules([rec({ sizes: ["M", "M"] })]);
  assertEquals(r.code, 0, r.stdout);
});

Deno.test("rules: priority — none, a P4, two values", async () => {
  let r = await rules([rec({ priorities: [] })]);
  assertStringIncludes(r.stdout, "priority (none)");
  r = await rules([rec({ priorities: ["P4"] })]);
  assertEquals(r.code, 1);
  assertStringIncludes(r.stdout, "priority (P4 is not one of P0 P1 P2 P3)");
  r = await rules([rec({ priorities: ["P1", "P2"] })]);
  assertStringIncludes(r.stdout, "priority (2 values: P1, P2)");
});

Deno.test("rules: outcome — Ready, a marked comment, or closed not_planned; nothing else", async () => {
  const off = { status: "Backlog" };
  let r = await rules([rec(off)]);
  assertEquals(r.code, 1);
  assertStringIncludes(r.stdout, "outcome (not in Ready, no 🤖 specnaut-groom comment");

  r = await rules([rec({ ...off, comments: ["  🤖 specnaut-groom — which tenant?"] })]);
  assertEquals(r.code, 0, r.stdout);
  // A comment without the marker is not the groom's.
  r = await rules([rec({ ...off, comments: ["which tenant? 🤖 specnaut-groom"] })]);
  assertEquals(r.code, 1);

  r = await rules([rec({ ...off, state: "closed", closed_reason: "not_planned" })]);
  assertEquals(r.code, 0, r.stdout);
  r = await rules([rec({ ...off, state: "closed", closed_reason: "completed" })]);
  assertEquals(r.code, 1);
});

Deno.test("rules: --ready names the board's column; none turns the promotion check off", async () => {
  let r = await rules([rec({ status: "To do" })], ["--ready", "to DO"]);
  assertEquals(r.code, 0, r.stdout);
  r = await rules([rec({ status: "Ready" })], ["--ready", "Groomed"]);
  assertEquals(r.code, 1);
  assertStringIncludes(r.stdout, "not in Groomed");
  r = await rules([rec({ status: "Backlog" })], ["--ready", "none"]);
  assertEquals(r.code, 0, r.stdout);
});

Deno.test("rules: unreadable comments are said so, and still count as missing", async () => {
  const r = await rules([rec({ status: "Backlog", comments: null })]);
  assertEquals(r.code, 1);
  assertStringIncludes(r.stdout, "comments unreadable on this backend");
});

Deno.test("rules: one line per incomplete item, every missing part on it", async () => {
  const r = await rules([
    rec({ item: "1" }),
    rec({ item: "2", body: "", sizes: [], priorities: ["P9"], status: "Backlog" }),
  ]);
  assertEquals(r.code, 1);
  const lines = r.stdout.trim().split("\n");
  assertEquals(lines.length, 1, r.stdout);
  assert(lines[0].startsWith("#2: missing "), lines[0]);
  for (
    const part of [
      "## Why",
      "## Acceptance criteria",
      "## Out of scope",
      "size",
      "priority",
      "outcome",
    ]
  ) {
    assertStringIncludes(lines[0], part);
  }
});

Deno.test("rules: never 'complete' on input it could not read — exit 2", async () => {
  for (
    const bad of [
      "", // no record at all
      "{not json",
      JSON.stringify({ ...rec(), sizes: "M" }) + "\n", // wrong shape
      JSON.stringify({ ...rec(), state: "opened" }) + "\n", // un-normalised
      JSON.stringify((({ body: _b, ...rest }) => rest)(rec())) + "\n", // a key missing
    ]
  ) {
    const r = await rules(bad);
    assertEquals(r.code, 2, `input ${JSON.stringify(bad)} → ${r.stdout}`);
    assertEquals(r.stdout, "");
  }
  assertEquals((await rules([rec()], ["--bogus"])).code, 2);
});
