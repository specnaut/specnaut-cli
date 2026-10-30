import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DiffProjectUseCase } from "../../src/application/diff_project.ts";
import type { FsReader, Harness, LockStore } from "../../src/application/ports.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import { linkIdentity } from "../../src/domain/context_link.ts";
import { sha256Hex } from "../../src/domain/sha256.ts";
import { DenoFsReader } from "../../src/infrastructure/fs_reader.ts";
import { CAN_LINK, makeLink } from "../helpers/link_text.ts";
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
  return await diffWith(fakeReader(files, links), "/p", onlyCustomised);
}

async function diffWith(reader: FsReader, projectDir: string, onlyCustomised = false) {
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
    reader,
    lockStore,
    core: [],
    findHarness: () => harness,
  }).execute({ projectDir, onlyCustomised, path: null });
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

/**
 * The same judgement through the real reader, on a real disk: `fakeReader`
 * models `readEntry`, and a model can agree with the use case while the
 * adapter reads the link through.
 */
async function onDisk(plant: (dir: string) => Promise<void>, onlyCustomised = false) {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(dir, "AGENTS.md"), AGENTS["AGENTS.md"]);
    await Deno.mkdir(join(dir, ".claude"));
    await plant(dir);
    return (await diffWith(new DenoFsReader(), dir, onlyCustomised)).results;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("diff on disk: our real link matches, never read through to AGENTS.md", {
  ignore: !CAN_LINK,
}, async () => {
  const results = await onDisk((dir) => makeLink("../AGENTS.md", join(dir, DEST)));
  assertEquals(results, [{ kind: "matches", dest: DEST }]);
});

Deno.test("diff on disk: our fallback file matches, a customized one differs", async () => {
  const fallback = await onDisk((dir) => Deno.writeTextFile(join(dir, DEST), "@../AGENTS.md\n"));
  assertEquals(fallback, [{ kind: "matches", dest: DEST }]);
  const mine = await onDisk((dir) => Deno.writeTextFile(join(dir, DEST), "# mine\n"), true);
  assertEquals(mine.map((r) => r.kind), ["differs"]);
});
