import { assertEquals } from "@std/assert";
import { gatherLinkEvidence } from "../../src/application/link_evidence.ts";
import { DiffProjectUseCase } from "../../src/application/diff_project.ts";
import { surveyContextLinks } from "../../src/application/upgrade_context_links.ts";
import type { FsReader, Harness, LockStore } from "../../src/application/ports.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import type { Bundle } from "../../src/domain/template.ts";
import { linkIdentity, linkOwnership, type LinkState } from "../../src/domain/context_link.ts";
import { sha256Hex } from "../../src/domain/sha256.ts";
import { fakeReader } from "./upgrade_fakes.ts";

/**
 * `diff` and `upgrade` judge a context-link destination on the same evidence
 * (cli#693). They used to gather it twice, and the copies had drifted: for a
 * symlink, `upgrade` hashed `linkIdentity(target)` while `diff` passed no sha.
 */

const DEST = ".claude/CLAUDE.md";
const LINK = { symlinkTo: "../AGENTS.md", content: "@../AGENTS.md\n" };
const BUNDLE: Bundle = { [DEST]: { ...LINK, executable: false } };
const AGENTS_MD = "# AGENTS\n";

const lockWithSha = (sha: string): InstalledLock => ({
  version: 2,
  harness: "claude",
  backlogBackend: "local",
  versionScheme: "semver",
  specBackend: "local",
  templatesVersion: "1.0.0",
  entries: new Map([[DEST, {
    sha256: sha,
    installedAt: "2026-01-01T00:00:00Z",
    templatesVersion: "1.0.0",
  }]]),
});

Deno.test("link evidence: a symlink is hashed by its identity, whoever asks", async () => {
  const reader = fakeReader({ "AGENTS.md": AGENTS_MD }, {
    [DEST]: { target: "../AGENTS.md", resolved: "AGENTS.md" },
  });
  const ev = await gatherLinkEvidence(reader, "/p", DEST, LINK.symlinkTo, "L");
  assertEquals(ev.diskSha, await sha256Hex(linkIdentity("../AGENTS.md")));
  assertEquals(ev.lockSha, "L");
  assertEquals(ev.targetEntry, { kind: "file", content: AGENTS_MD });
});

Deno.test("link evidence: a file is hashed by its content, an absent dest by nothing", async () => {
  const file = await gatherLinkEvidence(
    fakeReader({ [DEST]: "# mine\n" }),
    "/p",
    DEST,
    LINK.symlinkTo,
    undefined,
  );
  assertEquals(file.diskSha, await sha256Hex("# mine\n"));
  assertEquals(file.targetEntry, null);
  const absent = await gatherLinkEvidence(fakeReader({}), "/p", DEST, LINK.symlinkTo, undefined);
  assertEquals(absent, { disk: null, diskSha: undefined, lockSha: undefined, targetEntry: null });
});

/** What `upgrade` decided about DEST: its plannable state, or `inverted` when refused. */
async function upgradeState(reader: FsReader, lock: InstalledLock): Promise<LinkState> {
  const survey = await surveyContextLinks(reader, "/p", BUNDLE, lock, () => false);
  if (survey.refused.some((r) => r.dest === DEST)) return "inverted";
  return survey.states.get(DEST)!;
}

/** What `diff` decided about DEST, as the ownership its verdict implies. */
async function diffOwnership(reader: FsReader, lock: InstalledLock) {
  const harness: Harness = { key: "claude", displayName: "Claude (test)", mapBundle: () => BUNDLE };
  const lockStore: LockStore = {
    read: () => Promise.resolve(lock),
    write: () => Promise.resolve(),
    lockPath: (d) => `${d}/.specnaut/installed.lock`,
  };
  const diff = new DiffProjectUseCase({ reader, lockStore, core: [], findHarness: () => harness });
  const all = await diff.execute({ projectDir: "/p", onlyCustomised: false, path: null });
  const mine = await diff.execute({ projectDir: "/p", onlyCustomised: true, path: null });
  const [result] = all.results;
  if (result.kind === "matches") return "ours";
  return mine.results.length === 1 ? "theirs" : "rewritable";
}

const linked = (target: string, resolved: string | null) => ({ [DEST]: { target, resolved } });

Deno.test("diff and upgrade classify the same on-disk link the same way", async () => {
  const ours = await sha256Hex(linkIdentity("../AGENTS.md"));
  const generated = "# written by an older release\n";
  const cases: Array<{
    name: string;
    files: Record<string, string>;
    links?: Record<string, { target: string; resolved: string | null }>;
    lockSha: string;
  }> = [
    {
      name: "our link",
      files: { "AGENTS.md": AGENTS_MD },
      links: linked("../AGENTS.md", "AGENTS.md"),
      lockSha: ours,
    },
    {
      name: "a foreign link whose lock sha is the identity of its own text",
      files: { "AGENTS.md": AGENTS_MD, "OTHER.md": "x" },
      links: linked("../OTHER.md", "OTHER.md"),
      lockSha: await sha256Hex(linkIdentity("../OTHER.md")),
    },
    {
      name: "our fallback",
      files: { "AGENTS.md": AGENTS_MD, [DEST]: LINK.content },
      lockSha: ours,
    },
    {
      name: "a materialised link",
      files: { "AGENTS.md": AGENTS_MD, [DEST]: "../AGENTS.md\n" },
      lockSha: ours,
    },
    {
      name: "a generated file the lock recorded",
      files: { "AGENTS.md": AGENTS_MD, [DEST]: generated },
      lockSha: await sha256Hex(generated),
    },
    {
      name: "a customized file",
      files: { "AGENTS.md": AGENTS_MD, [DEST]: "# mine\n" },
      lockSha: ours,
    },
    {
      name: "an inverted consolidation",
      files: { [DEST]: "# the real instructions\n" },
      links: { "AGENTS.md": { target: ".claude/CLAUDE.md", resolved: DEST } },
      lockSha: ours,
    },
  ];
  for (const c of cases) {
    const reader = fakeReader(c.files, c.links ?? {});
    const lock = lockWithSha(c.lockSha);
    const upgrade = linkOwnership(await upgradeState(reader, lock));
    assertEquals(await diffOwnership(reader, lock), upgrade, c.name);
  }
});
