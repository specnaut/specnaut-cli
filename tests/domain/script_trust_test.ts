import { assertEquals } from "@std/assert";
import {
  BASE_LOCK,
  type BaseEntry,
  type BundleRule,
  judgeScripts,
  REASON,
  type TreeEntry,
  type TrustInput,
} from "../../src/domain/script_trust.ts";

/** One row of the decision table per test: the input that differs from a clean base, and its verdict. */

const enc = (s: string) => new TextEncoder().encode(s);
const P = ".specnaut/scripts/bash/git-read.sh";
const Q = ".specnaut/scripts/bash/size-ratchet.sh";
const BASE = "echo base\n";

const file = (path: string, text: string, links = 1): TreeEntry => ({
  kind: "file",
  path,
  bytes: enc(text),
  links,
});
const blob = (path: string, text: string): BaseEntry => ({ kind: "blob", path, bytes: enc(text) });
const mapped = (files: Record<string, string> = {}): BundleRule => ({
  kind: "mapped",
  files: new Map(Object.entries(files).map(([p, t]) => [p, enc(t)])),
});

function judge(over: Partial<TrustInput> & { entries?: TreeEntry[] } = {}) {
  const input: TrustInput = {
    tree: { kind: "walked", entries: over.entries ?? [file(P, BASE)] },
    tip: over.tip ?? [blob(P, BASE)],
    mergeBase: over.mergeBase ?? [blob(P, BASE)],
    bundle: over.bundle ?? mapped({ [P]: BASE }),
    ...(over.tree ? { tree: over.tree } : {}),
  };
  return judgeScripts(input);
}

/** A bundle whose copy of P is neither the tree's nor the base's. */
const OTHER_BUNDLE = mapped({ [P]: "echo bundled\n" });

const untrusted = (path: string, reason: string) => ({
  trusted: false,
  untrusted: [{ path, reason }],
});
const TRUSTED = { trusted: true, untrusted: [] };

Deno.test("bytes equal to the base tip's blob are trusted: a customised script the base already has", () => {
  const custom = "echo customised by the project\n";
  assertEquals(
    judge({
      entries: [file(P, custom)],
      tip: [blob(P, custom)],
      bundle: mapped({ [P]: "echo bundled\n" }),
    }),
    TRUSTED,
  );
});

Deno.test("bytes equal to the bundled copy are trusted: a file an upgrade branch rewrote", () => {
  const upgraded = "echo new release\n";
  assertEquals(judge({ entries: [file(P, upgraded)], bundle: mapped({ [P]: upgraded }) }), TRUSTED);
});

Deno.test("an upgrade branch adds a script the bundle ships: trusted", () => {
  const entries = [file(P, BASE), file(Q, "echo ratchet\n")];
  assertEquals(judge({ entries, bundle: mapped({ [Q]: "echo ratchet\n" }) }), TRUSTED);
});

Deno.test("an upgrade branch drops a script the bundle no longer ships: trusted", () => {
  assertEquals(judge({ entries: [file(P, BASE)], tip: [blob(P, BASE), blob(Q, "old")] }), TRUSTED);
});

Deno.test("a script the branch edited differs from base", () => {
  assertEquals(judge({ entries: [file(P, "echo edited\n")] }), untrusted(P, REASON.differs));
});

Deno.test("a link in the folder is never followed, whatever it points at", () => {
  assertEquals(judge({ entries: [{ kind: "link", path: P }] }), untrusted(P, REASON.link));
});

Deno.test("a FIFO or any other non-regular entry is untrusted", () => {
  assertEquals(judge({ entries: [{ kind: "other", path: P }] }), untrusted(P, REASON.notRegular));
});

Deno.test("a file linked more than once is untrusted, even with the base's bytes", () => {
  assertEquals(judge({ entries: [file(P, BASE, 2)] }), untrusted(P, REASON.hardLinked));
});

Deno.test("a file the walk could not read is untrusted with its reason", () => {
  const entries: TreeEntry[] = [{ kind: "unreadable", path: P, why: "permission denied" }];
  assertEquals(judge({ entries }), untrusted(P, "unreadable: permission denied"));
});

Deno.test("an added file neither the base nor the bundle has is untrusted", () => {
  const entries = [file(P, BASE), file(Q, "echo added\n")];
  assertEquals(judge({ entries }), untrusted(Q, REASON.notOnBase));
});

Deno.test("a name that differs from the base's only in case is untrusted, and so is the base name", () => {
  const twin = ".specnaut/scripts/bash/Git-read.sh";
  assertEquals(judge({ entries: [file(twin, BASE)] }), {
    trusted: false,
    untrusted: [{ path: twin, reason: REASON.caseDiffers }, { path: P, reason: REASON.missing }],
  });
});

Deno.test("a base path missing from the tree is untrusted while the bundle still ships it", () => {
  const verdict = judge({ entries: [], bundle: mapped({ [P]: BASE }) });
  assertEquals(verdict, untrusted(P, REASON.missing));
});

Deno.test("a submodule under the folder on base is untrusted, whatever the tree holds there", () => {
  const tip: BaseEntry[] = [blob(P, BASE), { kind: "submodule", path: Q }];
  assertEquals(judge({ tip }), untrusted(Q, REASON.submodule));
});

Deno.test("a link on base where the tree holds a file is untrusted", () => {
  const tip: BaseEntry[] = [{ kind: "link", path: P }];
  assertEquals(judge({ tip, bundle: OTHER_BUNDLE }), untrusted(P, REASON.baseNotRegular));
});

Deno.test("a file equal to its merge-base blob, where only the tip moved, is behind base", () => {
  const tip = [blob(P, "echo newer on base\n")];
  assertEquals(judge({ tip, bundle: OTHER_BUNDLE }), untrusted(P, REASON.behind));
});

Deno.test("an older copy the merge base does not hold is not called behind", () => {
  const verdict = judge({ entries: [file(P, "echo old\n")], tip: [blob(P, "echo new\n")] });
  assertEquals(verdict, untrusted(P, REASON.differs));
});

Deno.test("a checkout with CRLF line endings is untrusted, and says why", () => {
  assertEquals(judge({ entries: [file(P, "echo base\r\n")] }), untrusted(P, REASON.lineEndings));
});

Deno.test("no lock at base: the base rule alone, and a file the base lacks is a first install", () => {
  const entries = [file(P, BASE), file(Q, "echo new\n")];
  const verdict = judge({ entries, bundle: { kind: "no_lock_at_base" } });
  assertEquals(verdict, untrusted(Q, REASON.firstInstall));
  assertEquals(judge({ bundle: { kind: "no_lock_at_base" } }), TRUSTED);
});

Deno.test("no lock at base: a base file the tree lacks is missing, with no bundle to excuse it", () => {
  const verdict = judge({ entries: [], bundle: { kind: "no_lock_at_base" } });
  assertEquals(verdict, untrusted(P, REASON.missing));
});

Deno.test("an unreadable lock at base is untrusted with its reason, never a throw", () => {
  const verdict = judge({ bundle: { kind: "unavailable", why: "is not valid YAML" } });
  assertEquals(verdict, untrusted(BASE_LOCK, "at base: is not valid YAML"));
});

Deno.test("a lock at base naming a harness this binary does not know is untrusted", () => {
  const why = "names a harness this binary does not know: acme";
  const verdict = judge({ bundle: { kind: "unavailable", why } });
  assertEquals(verdict, untrusted(BASE_LOCK, `at base: ${why}`));
});

Deno.test("a folder on the way that is a link stops the walk: the whole folder is untrusted", () => {
  const tree = { kind: "blocked", path: ".specnaut", why: REASON.link } as const;
  assertEquals(judge({ tree }), untrusted(".specnaut", REASON.link));
});

Deno.test("no scripts on base and none in the tree: nothing to run, nothing untrusted", () => {
  assertEquals(judge({ entries: [], tip: [], mergeBase: [] }), TRUSTED);
});

Deno.test("a local base holding commits origin lacks is untrusted: the base is origin's copy", () => {
  const verdict = judgeScripts({
    tree: { kind: "walked", entries: [file(P, BASE)] },
    tip: [blob(P, BASE)],
    mergeBase: [blob(P, BASE)],
    bundle: mapped({ [P]: BASE }),
    localBaseAhead: "main",
  });
  assertEquals(verdict, untrusted("refs/heads/main", "local main ahead of origin"));
});
