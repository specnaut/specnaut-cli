import { assert, assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import type { SandboxedBackend } from "../../src/domain/sandbox.ts";
import { live, NO_PERL, skipOf, STATUSES } from "../infrastructure/sandbox_live_fixture.ts";
import {
  assertRefused,
  EPERM,
  type Isolation,
  probeInside,
  probeOnHost,
  sandboxed,
  snapshot,
  withIsolation,
} from "./isolation_world.ts";

/**
 * A branch's code reaches nothing outside its run, on each backend this host offers, beside a
 * control that proves each probe works: the branch's own test runs and prints what only its tree
 * holds, and every attempt that fails inside succeeds with the same probe where access is granted
 * (on the host, or in the run's own temp folder). A backend this host lacks is skipped, saying why.
 * The probe's network attempts use perl, so a container's image (SPECNAUT_LIVE_IMAGE) holds it too:
 * one without it fails the network case with `no-perl`, never passes it.
 */

/** The link, the repository-shaped folder and the instruction files are listed, never written. */
async function assertListedOnly(iso: Isolation): Promise<void> {
  const kinds = Object.fromEntries(iso.exported.listed.map((e) => [e.path, e.kind]));
  assertEquals(kinds, {
    ".claude/settings.json": "instruction",
    ".mcp.json": "instruction",
    "AGENTS.md": "instruction",
    "link-to-token": "link",
    "nested": "repository",
    "sub/CLAUDE.md": "instruction",
  });
  for (const copy of [iso.exported.scratch, iso.exported.seats]) {
    const files = [...(await snapshot(copy)).entries()];
    assertEquals(files.filter(([, text]) => text.includes(iso.canary)), [], copy);
    assertEquals(files.filter(([path]) => /^(nested|link-to-token)/.test(path)), [], copy);
  }
}

/** Runs `fn` on every backend, skipped where this host cannot run it. */
function eachBackend(title: string, fn: (kind: SandboxedBackend, iso: Isolation) => Promise<void>) {
  for (const status of STATUSES) {
    const missing = skipOf(status) ?? NO_PERL;
    Deno.test({
      name: live(`isolation live: on ${status.kind}, ${title}`, missing),
      ignore: missing !== null,
      fn: () => withIsolation((iso) => fn(status.kind, iso)),
    });
  }
}

eachBackend("the branch's own test runs and prints what only its tree holds", async (kind, iso) => {
  const { outcome, out } = await sandboxed(kind, iso, ["/bin/sh", "./test.sh"]);
  assertEquals(outcome, { kind: "exited", code: 0 });
  assertMatch(out, new RegExp(`^control ran: ${iso.nonce} with home /\\S+/home\n$`));
  assert(!out.includes(iso.home), "the run was given the user's home");
});

eachBackend(
  "the planted token, hosts.yml, the checkout's .env and our token variables stay out of reach",
  async (kind, iso) => {
    const { token, hosts, dotenv } = iso.planted;
    const words = [`read=${token}`, `read=${hosts}`, `read=${dotenv}`, `env=${iso.secret}`];
    const host = await probeOnHost(iso, words);
    assertEquals(host.get(`read ${token}`), `ok ${iso.secret}`);
    assertEquals(host.get(`read ${hosts}`), `ok github.com:    oauth_token: ${iso.secret}`);
    assertEquals(host.get(`read ${dotenv}`), `ok TOKEN=${iso.secret}`);
    assertEquals(host.get(`env ${iso.secret}`), "ok");
    const inside = await probeInside(kind, iso, words);
    for (const word of words) {
      if (kind === "container") assertEquals(inside.get(word.replace("=", " ")), "ok", word);
      else assertRefused(inside.get(word.replace("=", " ")), word);
    } // red probe, never to land
  },
);

eachBackend("the forge stand-in is never reached, and only loopback exists", async (kind, iso) => {
  const word = `connect=${iso.forge.address}`;
  assertEquals((await probeOnHost(iso, [word])).get(`connect ${iso.forge.address}`), "ok");
  assertEquals(await iso.forge.settled(), 1, "the forge stand-in missed the control's connection");
  const inside = await probeInside(kind, iso, [word, "ifaces=-"]);
  // `sandbox-exec` refuses the connect; a namespace of its own has no listener on its loopback.
  const reasons = kind === "seatbelt" ? [EPERM] : ["Connection refused", "Network is unreachable"];
  assertRefused(inside.get(`connect ${iso.forge.address}`), word, reasons);
  // The run has ended: a connection it made is counted now, so no wait could add to the count.
  assertEquals(await iso.forge.settled(), 1, "the forge stand-in accepted the run's connection");
  // Linux backends run in a network namespace of their own: the probe lists its one interface.
  if (kind !== "seatbelt") assertEquals(inside.get("ifaces -"), "lo");
});

eachBackend(
  "the export's git/ and seats/ folders are out of reach: its scratch copy is all it sees",
  async (kind, iso) => {
    const { gitDir, seats } = iso.exported;
    const words = [`read=${join(gitDir, "HEAD")}`, "read=../git/HEAD", `list=${seats}`];
    const host = await probeOnHost(iso, words);
    for (const word of words) assert(host.get(word.replace("=", " "))?.startsWith("ok"), word);
    const inside = await probeInside(kind, iso, words);
    for (const word of words) assertRefused(inside.get(word.replace("=", " ")), word);
  },
);

eachBackend(
  "a rewrite, a .git and a link written to its tree fail and reach no copy on the host",
  async (kind, iso) => {
    const before = [await snapshot(iso.exported.scratch), await snapshot(iso.exported.seats)];
    const kinds = ["rewrite", "dotgit", "plantlink"];
    const words = kinds.flatMap((k) => [`${k}=.`, `${k}=TMPDIR`]);
    const inside = await probeInside(kind, iso, words);
    for (const k of kinds) {
      assertEquals(inside.get(`${k} TMPDIR`), "ok", `${k} fails even where writes are granted`);
      assertRefused(inside.get(`${k} .`), `${k} in the tree`);
    }
    const after = [await snapshot(iso.exported.scratch), await snapshot(iso.exported.seats)];
    assertEquals(after, before);
  },
);

eachBackend(
  "the branch's link and instruction files are never written; a plain file beside them is",
  async (kind, iso) => {
    const words = [`grep=${iso.canary}`, `grep=${iso.control}`, "read=link-to-token"];
    const inside = await probeInside(kind, iso, [...words, "read=hello.txt"]);
    assertEquals(inside.get("read hello.txt"), "ok from the branch");
    assertEquals(inside.get(`grep ${iso.control}`), "./sub/notes.md");
    assertEquals(inside.get(`grep ${iso.canary}`), "none");
    assertRefused(inside.get("read link-to-token"), "read link-to-token");
    await assertListedOnly(iso);
  },
);
