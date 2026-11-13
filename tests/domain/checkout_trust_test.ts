import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import {
  CHECKOUT_REASON,
  type CheckoutEntry,
  type CheckoutInput,
  judgeCheckout,
  restartAdvice,
} from "../../src/domain/checkout_trust.ts";
import { type BaseEntry, REASON, type TreeEntry } from "../../src/domain/script_trust.ts";

/** One condition of the precondition per test: the input that differs from a clean checkout. */

const enc = (s: string) => new TextEncoder().encode(s);
const S = ".claude/settings.json";
const A = "AGENTS.md";
const OUTSIDE = "a".repeat(40);
const OWN = "b".repeat(40);

const file = (path: string, text: string, links = 1): TreeEntry => ({
  kind: "file",
  path,
  bytes: enc(text),
  links,
});
const blob = (path: string, text: string): BaseEntry => ({ kind: "blob", path, bytes: enc(text) });
const CLEAN_TREE = [file(S, "{}\n"), file(A, "rules\n")];
const CLEAN_TIP = [blob(S, "{}\n"), blob(A, "rules\n")];

function judge(over: Partial<CheckoutInput> & { entries?: CheckoutEntry[] } = {}) {
  return judgeCheckout({
    symlinks: over.symlinks ?? true,
    headCommits: over.headCommits ?? [],
    untrustedCommits: over.untrustedCommits ?? [OUTSIDE],
    scripts: over.scripts ?? { trusted: true, untrusted: [] },
    tree: over.tree ?? [{ kind: "walked", entries: over.entries ?? CLEAN_TREE }],
    tip: over.tip ?? CLEAN_TIP,
  });
}

const HOLDS = { holds: true, reasons: [] };
const fails = (path: string, reason: string) => ({ holds: false, reasons: [{ path, reason }] });

Deno.test("a checkout at the base, scripts trusted, every config file equal to the tip: it holds", () => {
  assertEquals(judge(), HOLDS);
});

Deno.test("HEAD holding a commit of the branch under review fails, naming the commit", () => {
  assertEquals(
    judge({ headCommits: [OWN, OUTSIDE] }),
    {
      holds: false,
      reasons: [
        { path: OWN, reason: CHECKOUT_REASON.headAhead },
        { path: OUTSIDE, reason: CHECKOUT_REASON.headHolds },
      ],
    },
  );
});

Deno.test("HEAD ahead of the base with a commit of its own fails too: HEAD must be the tip", () => {
  assertEquals(judge({ headCommits: [OWN] }), fails(OWN, CHECKOUT_REASON.headAhead));
});

Deno.test("scripts the script check does not trust fail it, with that check's reasons", () => {
  const untrusted = [{ path: ".specnaut/scripts/bash/x.sh", reason: REASON.differs }];
  assertEquals(judge({ scripts: { trusted: false, untrusted } }), {
    holds: false,
    reasons: untrusted,
  });
});

Deno.test("an untrusted script verdict with no reason still fails", () => {
  const v = judge({ scripts: { trusted: false, untrusted: [] } });
  assertEquals(v.holds, false);
  assertEquals(v.reasons.length, 1);
});

Deno.test("a config file whose bytes differ from the tip fails", () => {
  assertEquals(
    judge({ entries: [file(S, '{"hooks":{}}\n'), file(A, "rules\n")] }),
    fails(S, REASON.differs),
  );
});

Deno.test("a config file the tip does not have fails: no extra files", () => {
  const extra = ".claude/hooks/pre.sh";
  assertEquals(
    judge({ entries: [...CLEAN_TREE, file(extra, "echo\n")] }),
    fails(extra, REASON.notOnBase),
  );
});

Deno.test("a config file the tip has and the tree lacks fails", () => {
  assertEquals(judge({ entries: [file(S, "{}\n")] }), fails(A, REASON.missing));
});

Deno.test("a hard-linked config file fails, whatever its bytes", () => {
  assertEquals(
    judge({ entries: [file(S, "{}\n", 2), file(A, "rules\n")] }),
    fails(S, REASON.hardLinked),
  );
});

Deno.test("a name that differs from the tip's only in case fails as such", () => {
  assertEquals(
    judge({ entries: [file(S, "{}\n"), file("agents.md", "rules\n")] }),
    {
      holds: false,
      reasons: [
        { path: "agents.md", reason: REASON.caseDiffers },
        { path: A, reason: REASON.missing },
      ],
    },
  );
});

Deno.test("a submodule in the checked files fails, whatever the tree holds", () => {
  const sub = { kind: "submodule", path: ".claude/vendor" } as const;
  assertEquals(judge({ tip: [...CLEAN_TIP, sub] }), fails(sub.path, REASON.submodule));
});

Deno.test("a walk stopped on the way fails at the folder that stopped it", () => {
  assertEquals(
    judge({
      tree: [
        { kind: "walked", entries: [file(A, "rules\n")] },
        { kind: "blocked", path: ".claude", why: REASON.link },
      ],
    }),
    {
      holds: false,
      reasons: [{ path: ".claude", reason: REASON.link }, { path: S, reason: REASON.missing }],
    },
  );
});

Deno.test("special and unreadable entries fail", () => {
  assertEquals(
    judge({
      entries: [
        ...CLEAN_TREE,
        { kind: "other", path: ".claude/fifo" },
        { kind: "unreadable", path: ".claude/x", why: "denied" },
      ],
    }),
    {
      holds: false,
      reasons: [
        { path: ".claude/fifo", reason: REASON.notRegular },
        { path: ".claude/x", reason: "unreadable: denied" },
      ],
    },
  );
});

Deno.test("each failure is reported, in the order commits, scripts, config files", () => {
  const scripts = { trusted: false, untrusted: [{ path: "p", reason: "r" }] };
  const v = judge({ headCommits: [OUTSIDE], scripts, entries: [file(S, "{}\n")] });
  assertEquals(v.reasons.map((r) => r.path), [OUTSIDE, "p", A]);
});

Deno.test("the advice asks for a new harness process, never a branch switch in this one", () => {
  const advice = restartAdvice(OWN);
  assertMatch(advice, /a new harness process/i);
  assertMatch(advice, /never switch branches/i);
  assertMatch(advice, /outside `\.claude\/`/);
});

Deno.test("the advice gives the exact command, with the base's tip when it is known", () => {
  assertStringIncludes(restartAdvice(OWN), `git worktree add --detach <dir> ${OWN}`);
  assertStringIncludes(restartAdvice(null), "git worktree add --detach <dir> <BASE_TIP>");
});
