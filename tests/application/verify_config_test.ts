import { assertEquals } from "@std/assert";
import type {
  BaseFile,
  CheckoutTreeWalker,
  GitObjectReader,
} from "../../src/application/script_trust_ports.ts";
import { verifyConfig } from "../../src/application/verify_config.ts";
import type { CheckoutEntry, CheckoutWalk } from "../../src/domain/checkout_trust.ts";
import { REASON } from "../../src/domain/script_trust.ts";

/** The use case through fake ports: what the walk finds at each input's path, read from no disk. */

const GATES = ".specnaut/gates.yml";
const bytes = new TextEncoder().encode("fast_gate:\n  - true\n");

/** A git whose every commit holds the gates file and nothing else of the config. */
const git = {
  readFile: (_commit: string, path: string): Promise<BaseFile> =>
    Promise.resolve(path === GATES ? { kind: "blob", bytes } : { kind: "absent" }),
} as unknown as GitObjectReader;
const walker = (walk: CheckoutWalk): CheckoutTreeWalker => ({ walk: () => Promise.resolve(walk) });
const entries = (...e: CheckoutEntry[]): CheckoutWalk => ({ kind: "walked", entries: e });

async function gates(walk: CheckoutWalk) {
  const verdicts = await verifyConfig({ git, tree: walker(walk) }, { tip: "t", mergeBase: "m" });
  const v = verdicts.find((x) => x.class === "gates")!;
  return v.trusted ? "trusted" : v.reason;
}

Deno.test("the tree's copy equal to the tip's is trusted", async () => {
  assertEquals(await gates(entries({ kind: "file", path: GATES, bytes, links: 1 })), "trusted");
});

Deno.test("a name that differs only in case is refused, not taken for an absent file", async () => {
  const twin = { kind: "file" as const, path: ".specnaut/Gates.yml", bytes, links: 1 };
  assertEquals(await gates(entries(twin)), REASON.caseDiffers);
});

Deno.test("a hard-linked copy is refused, whatever its bytes", async () => {
  assertEquals(
    await gates(entries({ kind: "file", path: GATES, bytes, links: 2 })),
    REASON.hardLinked,
  );
});

Deno.test("a .specnaut folder the walk cannot enter refuses every class, with where it stopped", async () => {
  const blocked: CheckoutWalk = { kind: "blocked", path: ".specnaut", why: REASON.link };
  const verdicts = await verifyConfig({ git, tree: walker(blocked) }, { tip: "t", mergeBase: "m" });
  assertEquals(
    verdicts.map((v) => v.trusted ? "trusted" : v.reason),
    Array(6).fill(".specnaut: a link"),
  );
});
