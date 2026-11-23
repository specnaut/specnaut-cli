import { assert, assertEquals } from "@std/assert";
import type { BackendProbe, Engine } from "../../src/domain/sandbox.ts";
import { containerEngine } from "../../src/domain/sandbox_container.ts";
import { type FilterRecord, probeCalls } from "../../src/domain/sandbox_filter_probe.ts";
import { isPinned } from "../../src/domain/sandbox_image.ts";
import { isFilterArch } from "../../src/domain/sandbox_seccomp.ts";
import { seccompProfile } from "../../src/domain/sandbox_seccomp_profile.ts";
import type { FilterArch } from "../../src/domain/sandbox_syscalls.ts";
import { engineRunEnv } from "../../src/infrastructure/sandbox_engine_env.ts";
import { filterObserver } from "../../src/infrastructure/sandbox_filter_observer.ts";
import { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { capture, live, LIVE_IMAGE, probed, runIn, withLayout } from "./sandbox_live_fixture.ts";

/**
 * On a real engine, a container run records the names of the CLI's syscall profile its OCI runtime
 * put in force, as the filter probe saw them from inside: every name is either applied or named
 * dropped, the long-known ones are applied, and a name the profile file lacks, as a runtime whose
 * libseccomp skips it would leave it, is named dropped.
 *
 * Run on each engine this host offers a run (podman, docker, or both), with whatever OCI runtime
 * it is configured with (runc or crun); skipped, saying why, where none is, or where
 * SPECNAUT_LIVE_IMAGE names no digest-pinned image with /bin/sh. The probe reads the kernel's
 * answer, not the runtime's word, so every engine and runtime pair is read the same way; CI's
 * Linux host runs podman and docker, each on its default runtime there.
 */

/** Names every libseccomp a supported engine ships has known for years. */
const LONG_KNOWN = ["mount", "unshare", "setns", "keyctl", "bpf", "clone", "socket", "personality"];

/** `probe` with only `engine` there, so that a run is offered `engine` or nothing. */
function alone(engine: Engine): BackendProbe {
  return engine === "podman" ? { ...probed, docker: false } : { ...probed, podman: "absent" };
}

/** The engines this host offers a run, each on its own. */
const OFFERED = (["podman", "docker"] as const).filter((e) => containerEngine(alone(e)) === e);

function archOf(engine: Engine): FilterArch {
  const { arch } = alone(engine)[engine === "podman" ? "podmanPlatform" : "dockerPlatform"];
  if (arch === null || !isFilterArch(arch)) throw new Error(`${engine} runs on ${arch}`);
  return arch;
}

const lacking = isPinned(LIVE_IMAGE) ? null : "a digest-pinned image in SPECNAUT_LIVE_IMAGE";

/** The record of a run on `engine` that ended with 0. */
async function recorded(engine: Engine): Promise<FilterRecord | undefined> {
  let filter: FilterRecord | undefined;
  await withLayout("container", async ({ policy }) => {
    const observe = filterObserver(archOf(engine));
    const runner = (l: DenoProcessLauncher) =>
      new ContainerRunner(
        engine,
        engine,
        LIVE_IMAGE,
        l,
        { dropped: [], cpus: null },
        undefined,
        undefined,
        observe,
      );
    const { outcome, err } = await runIn(runner, policy, ["/bin/sh", "-c", "exit 0"]);
    assertEquals(outcome.kind === "exited" && outcome.code, 0, err);
    filter = outcome.filter;
  });
  return filter;
}

/** What the probe records on `engine` under the CLI's profile without the name `left`. */
async function recordedWithout(engine: Engine, left: string): Promise<FilterRecord> {
  let record: FilterRecord = { kind: "unobserved", why: "not run" };
  await withLayout("container", async ({ policy }) => {
    const runEnv = await engineRunEnv(engine, Deno.env.toObject());
    try {
      const profile = seccompProfile();
      const syscalls = profile.syscalls.map((r) => ({
        ...r,
        names: r.names.filter((n) => n !== left),
      }));
      const short = { ...profile, syscalls: syscalls.filter((r) => r.names.length > 0) };
      await Deno.writeTextFile(runEnv.seccomp, JSON.stringify(short));
      const name = `specnaut-sandbox-live${crypto.randomUUID().slice(0, 8)}`;
      const run = {
        image: LIVE_IMAGE,
        name,
        engine,
        dropped: [],
        cpus: null,
        seccomp: runEnv.seccomp,
      };
      // Its own sinks: a launcher on the process's stdout holds its writer for life.
      const launcher = new DenoProcessLauncher(capture().stream, capture().stream);
      record = await filterObserver(archOf(engine))({
        launcher,
        program: engine,
        runEnv,
        policy,
        run,
      });
    } finally {
      runEnv.release();
    }
  });
  return record;
}

if (OFFERED.length === 0) {
  Deno.test({
    name: live("container filter live: the run records its filter", "podman or docker"),
    ignore: true,
    fn: () => {},
  });
}

for (const engine of OFFERED) {
  Deno.test({
    name: live(`${engine} filter live: each profile name is recorded applied or dropped`, lacking),
    ignore: lacking !== null,
    fn: async () => {
      const record = await recorded(engine);
      assert(record?.kind === "observed", JSON.stringify(record));
      const names = probeCalls(archOf(engine)).map((c) => c.name);
      assertEquals([...record.applied, ...record.dropped].sort(), [...names].sort());
      for (const name of LONG_KNOWN) assert(record.applied.includes(name), `${name} applied`);
      assert(record.applied.includes("clone3") || record.dropped.includes("clone3"));
    },
  });
  Deno.test({
    name: live(`${engine} filter live: a name the profile lacks is recorded dropped`, lacking),
    ignore: lacking !== null,
    fn: async () => {
      const record = await recordedWithout(engine, "mount");
      assert(record.kind === "observed", JSON.stringify(record));
      assert(record.dropped.includes("mount"), JSON.stringify(record.dropped));
      assert(!record.applied.includes("mount"));
      assert(record.applied.includes("unshare"));
    },
  });
}
