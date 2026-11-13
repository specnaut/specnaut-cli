import {
  type BaseEntry,
  type BundleRule,
  judgeScripts,
  type TreeEntry,
  type TrustInput,
} from "../../src/domain/script_trust.ts";

/** A clean base for the script check, and the judge each decision-table row varies it through. */

export const enc = (s: string) => new TextEncoder().encode(s);
export const P = ".specnaut/scripts/bash/git-read.sh";
export const Q = ".specnaut/scripts/bash/size-ratchet.sh";
export const BASE = "echo base\n";

export const file = (path: string, text: string, links = 1): TreeEntry => ({
  kind: "file",
  path,
  bytes: enc(text),
  links,
});
export const blob = (path: string, text: string): BaseEntry => ({
  kind: "blob",
  path,
  bytes: enc(text),
});
export const mapped = (files: Record<string, string> = {}): BundleRule => ({
  kind: "mapped",
  files: new Map(Object.entries(files).map(([p, t]) => [p, enc(t)])),
});

export function judge(over: Partial<TrustInput> & { entries?: TreeEntry[] } = {}) {
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
export const OTHER_BUNDLE = mapped({ [P]: "echo bundled\n" });

export const untrusted = (path: string, reason: string) => ({
  trusted: false,
  untrusted: [{ path, reason }],
});
export const TRUSTED = { trusted: true, untrusted: [] };
