import { assertEquals } from "@std/assert";
import {
  CHECKOUT_REASON,
  type CheckoutEntry,
  judgeCheckout,
  type LinkEnd,
} from "../../src/domain/checkout_trust.ts";
import { type BaseEntry, REASON } from "../../src/domain/script_trust.ts";

/**
 * A link among the checked files: it holds only as the base's own link, and only when the walk
 * resolved it to a file it compared, or into a root it walks whole.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const A = "AGENTS.md";
const L = ".claude/CLAUDE.md";
const AGENTS_ID = "1:42";
const agents: CheckoutEntry = {
  kind: "file",
  path: A,
  bytes: enc("rules\n"),
  links: 1,
  id: AGENTS_ID,
};
const tipAgents: BaseEntry = { kind: "blob", path: A, bytes: enc("rules\n") };

const link = (path: string, target: string, end?: LinkEnd): CheckoutEntry => ({
  kind: "link",
  path,
  target,
  ...(end ? { end } : {}),
});
const tipLink = (path: string, target?: string): BaseEntry => ({ kind: "link", path, target });
const toAgents: LinkEnd = { kind: "inside", path: A, id: AGENTS_ID };

/** The tree holds AGENTS.md and `entry`; the tip holds AGENTS.md and `base`. */
function judge(entry: CheckoutEntry, base: BaseEntry) {
  return judgeCheckout({
    headCommits: [],
    untrustedCommits: [],
    scripts: { trusted: true, untrusted: [] },
    tree: [{ kind: "walked", entries: [agents, entry] }],
    tip: [tipAgents, base],
  });
}

const HOLDS = { holds: true, reasons: [] };
const fails = (path: string, reason: string) => ({ holds: false, reasons: [{ path, reason }] });

Deno.test("the base's own link, leading to a file the check compared, holds", () => {
  assertEquals(judge(link(L, "../AGENTS.md", toAgents), tipLink(L, "../AGENTS.md")), HOLDS);
});

Deno.test("the base's own link, leading into a root walked whole, holds", () => {
  const end: LinkEnd = { kind: "inside", path: ".claude/skills/task", id: null };
  const path = ".agents/skills/task";
  assertEquals(
    judge(link(path, "../../.claude/skills/task", end), tipLink(path, "../../.claude/skills/task")),
    HOLDS,
  );
});

Deno.test("a deep root that is itself a link on the base is judged as that link", () => {
  const end: LinkEnd = { kind: "inside", path: ".claude", id: null };
  assertEquals(judge(link(".agents", ".claude", end), tipLink(".agents", ".claude")), HOLDS);
  const specs: LinkEnd = { kind: "inside", path: ".specnaut/specs", id: "1:7" };
  assertEquals(
    judge(link(".agents", ".specnaut/specs", specs), tipLink(".agents", ".specnaut/specs")),
    fails(".agents", CHECKOUT_REASON.linkLeaves),
  );
});

Deno.test("a link into a subfolder no root walks fails, though its name is in the project", () => {
  const end: LinkEnd = { kind: "inside", path: ".specnaut/specs/001-x/plan.md", id: "1:9" };
  const target = "../.specnaut/specs/001-x/plan.md";
  assertEquals(
    judge(link(L, target, end), tipLink(L, target)),
    fails(L, CHECKOUT_REASON.linkLeaves),
  );
});

Deno.test("a link that resolves out of the project fails", () => {
  const target = "../../elsewhere/AGENTS.md";
  assertEquals(
    judge(link(L, target, { kind: "outside" }), tipLink(L, target)),
    fails(L, CHECKOUT_REASON.linkLeaves),
  );
});

Deno.test("a link that resolves nowhere fails, with why", () => {
  const end: LinkEnd = { kind: "unresolved", why: "no such file" };
  assertEquals(
    judge(link(L, "../GONE.md", end), tipLink(L, "../GONE.md")),
    fails(L, `${CHECKOUT_REASON.linkUnresolved}: no such file`),
  );
});

Deno.test("a link with no resolved end never holds", () => {
  assertEquals(
    judge(link(L, "../AGENTS.md"), tipLink(L, "../AGENTS.md")),
    fails(L, CHECKOUT_REASON.linkLeaves),
  );
});

Deno.test("a target with a backslash or a drive fails, even equal to the base's", () => {
  for (const target of ["..\\AGENTS.md", "C:/repo/AGENTS.md", "c:AGENTS.md"]) {
    assertEquals(
      judge(link(L, target, toAgents), tipLink(L, target)),
      fails(L, CHECKOUT_REASON.linkForm),
      target,
    );
  }
});

Deno.test("a link to another target than the tip's fails", () => {
  assertEquals(
    judge(link(L, "../NOTES.md", toAgents), tipLink(L, "../AGENTS.md")),
    fails(L, REASON.differs),
  );
});

Deno.test("a link with no known target never matches", () => {
  const entry: CheckoutEntry = { kind: "link", path: L, end: toAgents };
  assertEquals(judge(entry, tipLink(L)), fails(L, REASON.differs));
});

Deno.test("a link where the tip has a file fails", () => {
  const tip: BaseEntry = { kind: "blob", path: L, bytes: enc("rules\n") };
  assertEquals(judge(link(L, "../AGENTS.md", toAgents), tip), fails(L, REASON.differs));
});

Deno.test("a file holding the tip link's target holds: git's checkout where links are off", () => {
  const entry: CheckoutEntry = { kind: "file", path: L, bytes: enc("../AGENTS.md"), links: 1 };
  assertEquals(judge(entry, tipLink(L, "../AGENTS.md")), HOLDS);
});
