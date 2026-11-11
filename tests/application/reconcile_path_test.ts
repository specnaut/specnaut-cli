import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { PathRefusal } from "../../src/application/path_refusal.ts";
import {
  ListPendingReconciliationsUseCase,
  ReconcilePathUseCase,
} from "../../src/application/reconcile_path.ts";
import { sha256Hex } from "../../src/domain/sha256.ts";
import {
  mockLock,
  StubLockStore,
  StubReader,
  StubStagingStore,
  StubWriter,
} from "./reconcile_stubs.ts";

Deno.test(
  "reconcile --accept-upstream: writes upstream, backs up local, updates lock",
  async () => {
    const reader = new StubReader({
      ".claude/agents/developer.md": "LOCAL\n",
    });
    const writer = new StubWriter();
    const lockStore = new StubLockStore(mockLock());
    const staging = new StubStagingStore({
      ".claude/agents/developer.md": "UPSTREAM\n",
    });
    const uc = new ReconcilePathUseCase({ reader, writer, lockStore, stagingStore: staging });
    const result = await uc.execute({
      projectDir: "/tmp/proj",
      path: ".claude/agents/developer.md",
      mode: "accept-upstream",
      now: () => new Date("2026-05-16T00:00:00.000Z"),
    });
    assertEquals(result.status, "ok");

    // Wrote upstream to project path:
    assertEquals(writer.written[".claude/agents/developer.md"], "UPSTREAM\n");

    // Backed up local:
    assertEquals(
      writer.written[".claude/agents/developer.md.specnaut.bak"],
      "LOCAL\n",
    );

    // Updated lock entry SHA:
    const expectedSha = await sha256Hex("UPSTREAM\n");
    assertEquals(
      lockStore.lock.entries.get(".claude/agents/developer.md")?.sha256,
      expectedSha,
    );
  },
);

Deno.test(
  "reconcile --accept-current: leaves project alone, locks current SHA",
  async () => {
    const reader = new StubReader({ ".claude/agents/developer.md": "LOCAL\n" });
    const writer = new StubWriter();
    const lockStore = new StubLockStore(mockLock());
    const staging = new StubStagingStore({ ".claude/agents/developer.md": "UPSTREAM\n" });
    const uc = new ReconcilePathUseCase({ reader, writer, lockStore, stagingStore: staging });
    const result = await uc.execute({
      projectDir: "/tmp/proj",
      path: ".claude/agents/developer.md",
      mode: "accept-current",
      now: () => new Date("2026-05-16T00:00:00.000Z"),
    });
    assertEquals(result.status, "ok");

    // No project write (project file untouched):
    assertEquals(
      writer.written[".claude/agents/developer.md"],
      undefined,
    );

    // Lock SHA matches local content:
    const expectedSha = await sha256Hex("LOCAL\n");
    assertEquals(
      lockStore.lock.entries.get(".claude/agents/developer.md")?.sha256,
      expectedSha,
    );
  },
);

Deno.test("reconcile: errors when staging file missing", async () => {
  const reader = new StubReader({ ".claude/agents/developer.md": "LOCAL\n" });
  const writer = new StubWriter();
  const lockStore = new StubLockStore(mockLock());
  const staging = new StubStagingStore({});
  const uc = new ReconcilePathUseCase({ reader, writer, lockStore, stagingStore: staging });
  const result = await uc.execute({
    projectDir: "/tmp/proj",
    path: ".claude/agents/developer.md",
    mode: "accept-upstream",
    now: () => new Date(),
  });
  assertEquals(result.status, "no-staging");
});

Deno.test("reconcile: errors when lock entry missing", async () => {
  const reader = new StubReader({ ".claude/agents/developer.md": "LOCAL\n" });
  const writer = new StubWriter();
  const lockStore = new StubLockStore({ ...mockLock(), entries: new Map() });
  const staging = new StubStagingStore({ ".claude/agents/developer.md": "UPSTREAM\n" });
  const uc = new ReconcilePathUseCase({ reader, writer, lockStore, stagingStore: staging });
  const result = await uc.execute({
    projectDir: "/tmp/proj",
    path: ".claude/agents/developer.md",
    mode: "accept-upstream",
    now: () => new Date(),
  });
  assertEquals(result.status, "no-lock-entry");
});

// ── #613: `reconcile --status` lists only what `reconcile <path>` resolves ───

Deno.test(
  "ListPendingReconciliationsUseCase hides a staged path reconcile would refuse",
  async () => {
    const uc = new ListPendingReconciliationsUseCase({
      reader: new StubReader({ ".claude/agents/developer.md": "LOCAL\n", "AGENTS.md": "ours" }),
      lockStore: new StubLockStore(mockLock()),
      stagingStore: new StubStagingStore({
        ".claude/agents/developer.md": "UPSTREAM\n",
        // No lock entry, file on disk — `is not tracked by Specnaut`.
        "AGENTS.md": "UPSTREAM\n",
        // No lock entry, no file — a retired upstream path.
        ".claude/commands/retired.md": "UPSTREAM\n",
      }),
    });
    assertEquals(await uc.execute("/tmp/proj"), {
      pending: [".claude/agents/developer.md"],
      refused: [],
    });
  },
);

Deno.test(
  "ListPendingReconciliationsUseCase hides a tracked path whose project file is gone",
  async () => {
    const uc = new ListPendingReconciliationsUseCase({
      reader: new StubReader({}),
      lockStore: new StubLockStore(mockLock()),
      stagingStore: new StubStagingStore({ ".claude/agents/developer.md": "UPSTREAM\n" }),
    });
    assertEquals(await uc.execute("/tmp/proj"), { pending: [], refused: [] });
  },
);

/** A staging store that holds `developer.md` and refuses it on read with `err`. */
function refusingStore(err: Error): StubStagingStore {
  const store = new StubStagingStore({ ".claude/agents/developer.md": "UPSTREAM\n" });
  store.read = () => Promise.reject(err);
  return store;
}

Deno.test("ListPendingReconciliationsUseCase reports a copy the store refuses to read", async () => {
  const uc = new ListPendingReconciliationsUseCase({
    reader: new StubReader({ ".claude/agents/developer.md": "LOCAL\n" }),
    lockStore: new StubLockStore(mockLock()),
    stagingStore: refusingStore(new PathRefusal("refusing to read a staged path")),
  });
  const { pending, refused } = await uc.execute("/tmp/proj");
  assertEquals(pending, []);
  assertEquals(refused.map((r) => r.path), [".claude/agents/developer.md"]);
  assertStringIncludes(refused[0].reason, "refusing to read a staged path");
});

Deno.test("ListPendingReconciliationsUseCase still throws an error that is not a refusal", async () => {
  const uc = new ListPendingReconciliationsUseCase({
    reader: new StubReader({ ".claude/agents/developer.md": "LOCAL\n" }),
    lockStore: new StubLockStore(mockLock()),
    stagingStore: refusingStore(new Deno.errors.PermissionDenied("EACCES")),
  });
  await assertRejects(() => uc.execute("/tmp/proj"), Deno.errors.PermissionDenied);
});
