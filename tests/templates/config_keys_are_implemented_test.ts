// No shipped surface may promise a config key that no shipped script reads (#566).
//
// The defect this binds: `backlog-config.yml` shipped `project_node_id` and
// `status_field_id` with a comment saying they were "cached on first run", and
// the board skill documented a PO that would refresh them automatically when
// blank. Nothing implemented any of it. A user filling them in — or waiting for
// them to populate — was reading a promise the product never made good on, and
// nothing in the suite could tell, because an inert key breaks no behaviour.
//
// The class is broader than those two keys: a documented key with no reader is
// a promise, and the population that must satisfy it is "every key a shipped
// stub emits or a shipped doc shows", derived rather than listed. A test
// enumerating the two known-bad keys would go green the moment a third appeared.

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { join } from "@std/path";
import { BACKLOG_STRATEGIES } from "../../src/domain/backlog_strategies/registry.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPTS = join(ROOT, "templates/core/skills/task/scripts");

/** YAML scalar keys in a config body, ignoring comments and blank lines. */
function keysOf(yaml: string): string[] {
  const out = new Set<string>();
  for (const line of yaml.split("\n")) {
    const m = /^([a-z][a-z0-9_]*):/.exec(line.trim());
    if (m) out.add(m[1]);
  }
  return [...out];
}

async function backendCorpus(backend: string): Promise<string> {
  const dir = join(SCRIPTS, backend);
  let all = "";
  try {
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile) all += await Deno.readTextFile(join(dir, e.name));
    }
  } catch {
    return "";
  }
  return all;
}

// ---------------------------------------------------------------------------
// 1. Every key a generated stub emits must be read by that backend's scripts.
// ---------------------------------------------------------------------------

for (const strategy of BACKLOG_STRATEGIES) {
  const stub = strategy.initConfigStub?.({
    repo: "myorg/myproject",
    url: { kind: "github", projectNumber: 7 },
  } as never);
  if (typeof stub !== "string" || stub.length === 0) continue;

  Deno.test(`config keys: every key the ${strategy.key} stub emits is read by its scripts`, async () => {
    const corpus = await backendCorpus(strategy.key);
    if (corpus === "") return; // backend ships no scripts — nothing to promise against
    const orphans = keysOf(stub).filter((k) => !corpus.includes(k));
    assert(
      orphans.length === 0,
      `\`specnaut init --backlog ${strategy.key}\` generates ${
        orphans.map((k) => `\`${k}\``).join(", ")
      } but no script under templates/core/skills/task/scripts/${strategy.key}/ ` +
        `ever reads ${orphans.length === 1 ? "it" : "them"}. A key nothing reads is a ` +
        `promise the product does not keep: either wire it up, or delete it from the stub.`,
    );
  });
}

// ---------------------------------------------------------------------------
// 2. Same rule for the keys the shipped documentation SHOWS, in both mirrors.
//    A doc can promise a key the stub never emits, which is how the original
//    defect read to a user: the block was the only place the keys were
//    explained.
// ---------------------------------------------------------------------------

// One doc — `task/backlog.md`, which took over the backend sections of the
// `/board` SKILL.md in spec 037 — documents the config block of EVERY backend
// it can be configured for, so a key is checked against the union of all four script
// corpora rather than against one backend's. Per-backend attribution would
// need the fence's surrounding prose to name its backend, which is exactly the
// kind of coupling that rots; "some shipped script reads this key" is the
// property that actually matters here.
const DOCS = [
  "templates/core/skills/task/backlog.md",
  "plugin/skills/task/backlog.md",
];

async function allBackendsCorpus(): Promise<string> {
  let all = "";
  for await (const e of Deno.readDir(SCRIPTS)) {
    if (e.isDirectory) all += await backendCorpus(e.name);
  }
  return all;
}

/**
 * The ```yaml fences that are showing a backlog-config.yml.
 *
 * `\r` is stripped first. A Windows checkout with `core.autocrlf` on hands
 * these files back with CRLF endings, and a fence regex anchored on `\n`
 * matches nothing there — which emptied this test's whole population on
 * windows-latest while every POSIX runner stayed green.
 */
export function configFences(raw: string): string[] {
  const md = raw.replaceAll("\r\n", "\n");
  const out: string[] = [];
  const re = /```ya?ml\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    if (m[1].includes("backlog-config.yml")) out.push(m[1]);
  }
  return out;
}

for (const rel of DOCS) {
  Deno.test(`config keys: every key ${rel} documents is read by a script`, async () => {
    const md = await Deno.readTextFile(join(ROOT, rel));
    const fences = configFences(md);
    assert(
      fences.length > 0,
      `${rel} shows no backlog-config.yml block — this assertion has stopped ` +
        `looking at anything. Re-point it or delete it; a test whose population ` +
        `silently emptied is worse than no test.`,
    );
    const corpus = await allBackendsCorpus();
    const orphans = fences.flatMap(keysOf).filter((k) => !corpus.includes(k));
    assert(
      orphans.length === 0,
      `${rel} documents ${orphans.map((k) => `\`${k}\``).join(", ")} in a ` +
        `backlog-config.yml block, but no backlog script on any backend reads ` +
        `${orphans.length === 1 ? "it" : "them"}. A documented key with no reader ` +
        `is a promise the product does not keep.`,
    );
  });
}

// ---------------------------------------------------------------------------
// 3. A worked example must not be copyable as a working value.
// ---------------------------------------------------------------------------

for (const rel of DOCS) {
  Deno.test(`config keys: ${rel}'s example project_number is a placeholder`, async () => {
    const md = await Deno.readTextFile(join(ROOT, rel));
    for (const fence of configFences(md)) {
      for (const line of fence.split("\n")) {
        const m = /^\s*project_number:\s*(\S+)/.exec(line);
        if (!m) continue;
        assert(
          !/^"?\d+"?$/.test(m[1]),
          `${rel} shows \`${line.trim()}\`. A bare integer reads as a real ` +
            `value and gets copied verbatim; the read-only commands then keep ` +
            `working while every project write is refused. Use a placeholder in ` +
            `the same register as \`myorg/myproject\`.`,
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 4. The scanner survives a CRLF checkout.
// ---------------------------------------------------------------------------

Deno.test("config keys: the fence scanner is not defeated by CRLF line endings", async () => {
  // Regression guard. The first version of `configFences` anchored on `\n`,
  // matched nothing on a Windows checkout with `core.autocrlf` on, and emptied
  // this file's entire population there — every assertion above passing
  // vacuously except the one that checks the population is non-empty. That
  // guard is the only reason it surfaced as a red rather than as silence.
  // Normalised to LF FIRST, then converted. Reading the file and blindly
  // CRLF-ifying it assumes the checkout is LF — on windows-latest, where
  // `core.autocrlf` already handed back CRLF, that produced `\r\r\n` and this
  // very test failed on the platform it was written to protect.
  const raw = await Deno.readTextFile(join(ROOT, DOCS[0]));
  const posix = raw.replaceAll("\r\n", "\n");
  const crlf = posix.replaceAll("\n", "\r\n");
  assertEquals(
    configFences(crlf).length,
    configFences(posix).length,
    "a CRLF checkout must yield the same fences as an LF one",
  );
  assert(configFences(crlf).length > 0, "the CRLF path found nothing at all");
});
