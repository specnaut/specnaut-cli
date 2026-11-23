import { assert, assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import { containerArgs } from "../../src/domain/sandbox_args.ts";
import { answerOf, probeCalls } from "../../src/domain/sandbox_filter_probe.ts";
import { probeElf } from "../../src/domain/sandbox_probe_elf.ts";
import { removalOf } from "../../src/infrastructure/sandbox_container_removal.ts";
import { filterObserver, PROBE } from "../../src/infrastructure/sandbox_filter_observer.ts";
import type {
  ProcessLauncher,
  ProcessSpec,
  Started,
} from "../../src/infrastructure/sandbox_process.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";
import { containerTest, IMAGE } from "./sandbox_runner_fixture.ts";

/**
 * The filter observer: the probe written for the engine's machine, run in a container started as
 * the run's is, its folder mounted beside the run's, its container removed after; what it prints
 * read into the record, and a probe that could not run or answer recorded as unobserved.
 */

const PROGRAM = "/opt/engines/docker";
const RUN = {
  image: IMAGE,
  name: "specnaut-sandbox-x1",
  engine: "docker",
  dropped: [],
  cpus: null,
  seccomp: "/tmp/specnaut-engine-x/seccomp.json",
} as const;
const RUN_ENV = { env: { PATH: "/usr/bin:/bin" }, globals: ["--global"] };
const CALLS = probeCalls("x86_64");
const HELD = CALLS.map((c) => answerOf(c.refusal)).join("");

type Answer = { code: number; stdout: string; stderr?: string } | Error;

/**
 * A launcher whose first launch, the probe's, answers `answer` (or cannot start), having read the
 * probe file it is handed; every later one, a removal, exits 0.
 */
function probeLauncher(answer: Answer) {
  const launches: ProcessSpec[] = [];
  const probe: { bytes?: Uint8Array; mode?: number | null; dirMode?: number | null } = {};
  const launcher: ProcessLauncher = {
    start(spec): Started {
      launches.push(spec);
      const first = launches.length === 1;
      if (first && answer instanceof Error) throw answer;
      if (first) {
        probe.bytes = Deno.readFileSync(spec.args.at(-1)!);
        probe.mode = Deno.statSync(spec.args.at(-1)!).mode;
        probe.dirMode = Deno.statSync(dirname(spec.args.at(-1)!)).mode;
      }
      const said = first && !(answer instanceof Error) ? answer : { code: 0, stdout: "" };
      const ended = Promise.resolve(said.code);
      const [stdout, stderr] = [said.stdout, said.stderr ?? ""].map((s) => Promise.resolve(s));
      return { pid: 4001, ended, exited: ended, stdout, stderr, stop() {}, release() {} };
    },
    runSync: () => 0,
  };
  return { launcher, launches, probe };
}

async function observed(answer: Answer) {
  const fake = probeLauncher(answer);
  const policy = policyOf("container");
  const observe = filterObserver("x86_64");
  const record = await observe({ ...fake, program: PROGRAM, runEnv: RUN_ENV, policy, run: RUN });
  return { ...fake, policy, record };
}

containerTest(
  "filterObserver: the probe runs as the run's container would, then is removed",
  async () => {
    const { launches, policy, probe, record } = await observed({ code: 0, stdout: HELD });
    const dir = dirname(launches[0].args.at(-1)!);
    const reads = [...policy.reads, dir];
    const name = `${RUN.name}-filter`;
    const args = containerArgs({ ...policy, reads }, { ...RUN, name }, [join(dir, PROBE)]);
    assertEquals(launches[0], {
      cmd: PROGRAM,
      args: ["--global", ...args],
      env: RUN_ENV.env,
      stdout: "captured",
      stderr: "captured",
    });
    assertEquals(probe.bytes, probeElf("x86_64", CALLS));
    assertEquals([(probe.mode ?? 0) & 0o777, (probe.dirMode ?? 0) & 0o777], [0o755, 0o755]);
    assertEquals(launches.slice(1), [removalOf("docker", PROGRAM, name, RUN_ENV.env)]);
    assertEquals(record, { kind: "observed", applied: CALLS.map((c) => c.name), dropped: [] });
    assert(!(await exists(dir)), "the probe's folder is removed after the run");
  },
);

containerTest(
  "filterObserver: a name the probe saw pass the profile is recorded dropped",
  async () => {
    const printed = [...HELD];
    printed[CALLS.findIndex((c) => c.name === "mount")] = answerOf(38);
    const { record } = await observed({ code: 0, stdout: printed.join("") });
    assertEquals(record.kind === "observed" && record.dropped, ["mount"]);
  },
);

containerTest("filterObserver: a probe that failed is unobserved, with what it said", async () => {
  const { record } = await observed({ code: 126, stdout: "", stderr: "exec format error\n" });
  assertEquals(record, {
    kind: "unobserved",
    why: "the filter probe exited 126: exec format error",
  });
});

containerTest(
  "filterObserver: a probe that cannot start is unobserved, and its folder goes",
  async () => {
    const { record, launches } = await observed(new Error("no such file"));
    assertEquals(record, {
      kind: "unobserved",
      why: "the filter probe could not run: no such file",
    });
    assertEquals(launches.length, 2, "the removal still runs");
    assert(!(await exists(dirname(launches[0].args.at(-1)!))), "the probe's folder is removed");
  },
);

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}
