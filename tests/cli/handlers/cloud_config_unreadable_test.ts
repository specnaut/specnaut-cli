import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  CloudConfigUnreadable,
  FsBacklogConfigStore,
} from "../../../src/infrastructure/fs_backlog_config_store.ts";
import { runGate } from "../../../src/cli/handlers/gate_handler.ts";
import { runSpec, type SpecDeps } from "../../../src/cli/handlers/spec_handler.ts";

/**
 * cli#695 made an unreadable `backlog-config.yml` an error instead of "not
 * Cloud-linked". The gate and spec commands report it and exit 1 — never an
 * uncaught exception past their 0/1/5 exit codes.
 */

const MSG = "cannot read .specnaut/backlog-config.yml";

Deno.test("the store reports a config it cannot read as CloudConfigUnreadable", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(dir, ".specnaut", "backlog-config.yml"), { recursive: true });
    const e = await assertRejects(
      () => new FsBacklogConfigStore().readCloudConfig(dir),
      CloudConfigUnreadable,
    );
    assertStringIncludes(e.message, MSG);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

const unreadable = () => Promise.reject(new CloudConfigUnreadable(`${MSG}: Is a directory`));

Deno.test("gate exits 1 with the reason when the config cannot be read", async () => {
  const errs: string[] = [];
  const code = await runGate(
    {
      kind: "gate",
      sub: "status",
      apiUrl: null,
      type: null,
      title: null,
      payload: null,
      task: null,
      id: null,
    },
    { out: () => {}, err: (s) => errs.push(s), buildSession: unreadable },
  );
  assertEquals(code, 1);
  assertStringIncludes(errs.join("\n"), MSG);
});

Deno.test("spec exits 1 with the reason when the config cannot be read", async () => {
  const errs: string[] = [];
  const deps = {
    out: () => {},
    err: (s: string) => errs.push(s),
    projectDir: ".",
    readSpecBackend: () => Promise.resolve("cloud"),
    buildSession: unreadable,
  } as unknown as SpecDeps;
  const code = await runSpec({ kind: "spec", sub: "pull", task: 1, apiUrl: null }, deps);
  assertEquals(code, 1);
  assertStringIncludes(errs.join("\n"), MSG);
});
