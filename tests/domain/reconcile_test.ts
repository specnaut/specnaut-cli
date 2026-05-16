import { assertEquals } from "@std/assert";
import {
  computeAcceptCurrent,
  computeAcceptUpstream,
  type ReconcileInputs,
} from "../../src/domain/reconcile.ts";

const baseInputs = (overrides: Partial<ReconcileInputs> = {}): ReconcileInputs => ({
  path: ".claude/agents/developer.md",
  onDiskContent: "LOCAL CONTENT\n",
  stagingContent: "UPSTREAM CONTENT\n",
  templatesVersion: "1.6.0",
  now: new Date("2026-05-16T00:00:00.000Z"),
  ...overrides,
});

Deno.test(
  "computeAcceptUpstream: returns upstream as project write + new lock entry",
  async () => {
    const out = await computeAcceptUpstream(baseInputs());
    assertEquals(out.projectWrite, "UPSTREAM CONTENT\n");
    assertEquals(out.backupFromContent, "LOCAL CONTENT\n");
    assertEquals(out.newLockEntry.templatesVersion, "1.6.0");
    assertEquals(out.newLockEntry.installedAt, "2026-05-16T00:00:00.000Z");
    // SHA: deterministic for "UPSTREAM CONTENT\n"
    assertEquals(out.newLockEntry.sha256.length, 64);
  },
);

Deno.test(
  "computeAcceptCurrent: leaves project file untouched, locks current SHA",
  async () => {
    const out = await computeAcceptCurrent(baseInputs());
    assertEquals(out.projectWrite, null);
    assertEquals(out.backupFromContent, null);
    assertEquals(out.newLockEntry.templatesVersion, "1.6.0");
    // SHA of "LOCAL CONTENT\n"
    assertEquals(out.newLockEntry.sha256.length, 64);
  },
);

Deno.test(
  "computeAcceptUpstream: SHA differs from computeAcceptCurrent when contents differ",
  async () => {
    const inputs = baseInputs();
    const up = await computeAcceptUpstream(inputs);
    const cur = await computeAcceptCurrent(inputs);
    if (up.newLockEntry.sha256 === cur.newLockEntry.sha256) {
      throw new Error("SHAs must differ when contents differ");
    }
  },
);
