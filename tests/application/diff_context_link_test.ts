import { assertEquals } from "@std/assert";
import { DiffProjectUseCase } from "../../src/application/diff_project.ts";
import type { Harness, LockStore } from "../../src/application/ports.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import { linkIdentity } from "../../src/domain/context_link.ts";
import { sha256Hex } from "../../src/domain/sha256.ts";
import { fakeReader } from "./upgrade_fakes.ts";

/**
 * `specnaut diff` on a context link (cli#680): judged by what is there. Read
 * through the link, `.claude/CLAUDE.md` is the whole of `AGENTS.md`, which
 * would print as a diff against the one-line fallback on every project.
 */

const DEST = ".claude/CLAUDE.md";
const harness: Harness = {
  key: "claude",
  displayName: "Claude (test)",
  mapBundle: () => ({
    [DEST]: { content: "@../AGENTS.md\n", executable: false, symlinkTo: "../AGENTS.md" },
  }),
};

async function diff(
  files: Record<string, string>,
  links: Record<string, { target: string; resolved: string | null }>,
  onlyCustomised = false,
) {
  const lock: InstalledLock = {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "1.0.0",
    entries: new Map([[DEST, {
      sha256: await sha256Hex(linkIdentity("../AGENTS.md")),
      installedAt: "2026-01-01T00:00:00Z",
      templatesVersion: "1.0.0",
    }]]),
  };
  const lockStore: LockStore = {
    read: () => Promise.resolve(lock),
    write: () => Promise.resolve(),
    lockPath: (d) => `${d}/.specnaut/installed.lock`,
  };
  return await new DiffProjectUseCase({
    reader: fakeReader(files, links),
    lockStore,
    core: [],
    findHarness: () => harness,
  }).execute({ projectDir: "/p", onlyCustomised, path: null });
}

const AGENTS = { "AGENTS.md": "# AGENTS\nlots of rules\n" };

Deno.test("diff: our link matches, and is not read through", async () => {
  const { results } = await diff(AGENTS, {
    [DEST]: { target: "../AGENTS.md", resolved: "AGENTS.md" },
  });
  assertEquals(results, [{ kind: "matches", dest: DEST }]);
});

Deno.test("diff: our fallback file matches", async () => {
  const { results } = await diff({ ...AGENTS, [DEST]: "@../AGENTS.md\n" }, {});
  assertEquals(results, [{ kind: "matches", dest: DEST }]);
});

Deno.test("diff: a customized file differs from the link Specnaut would write, and counts as customised", async () => {
  const { results } = await diff({ ...AGENTS, [DEST]: "# mine\n" }, {}, true);
  assertEquals(results, [{
    kind: "differs",
    dest: DEST,
    diskContent: "# mine\n",
    bundledContent: "symlink → ../AGENTS.md\n",
  }]);
});
