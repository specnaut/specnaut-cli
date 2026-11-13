import type { CheckoutWalk } from "../../src/domain/checkout_trust.ts";
import type { BaseEntry } from "../../src/domain/script_trust.ts";

/** The checkout a session record is taken of, and the tip it is judged against. */

export const enc = (s: string) => new TextEncoder().encode(s);
export const S = ".claude/settings.json";
export const L = ".claude/skills/x";
export const HEAD = "c".repeat(40);
export const OUTSIDE = "a".repeat(40);
/** HEAD's reflog at session start: its length and digest. */
export const MARK = { bytes: 120, sha256: "e".repeat(64) };
const blob = (path: string, text: string): BaseEntry => ({ kind: "blob", path, bytes: enc(text) });
export const TIP: BaseEntry[] = [blob(S, "{}\n"), { kind: "link", path: L, target: "../x" }];
/** Where the link leads: a root the check walks whole. */
export const INSIDE = { kind: "inside", path: ".claude/x", id: null } as const;
export const WALK: CheckoutWalk[] = [{
  kind: "walked",
  entries: [
    { kind: "file", path: S, bytes: enc("{}\n"), links: 1, id: "1:2" },
    { kind: "link", path: L, target: "../x", end: INSIDE },
  ],
}];
