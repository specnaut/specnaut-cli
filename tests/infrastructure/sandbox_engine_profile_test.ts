import { assert, assertEquals, assertRejects } from "@std/assert";
import { dirname } from "@std/path";
import { seccompProfile } from "../../src/domain/sandbox_seccomp_profile.ts";
import { engineRunEnv } from "../../src/infrastructure/sandbox_engine_env.ts";
import type { ProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { policyOf } from "../domain/sandbox_fixture.ts";
import { exists, withEnv } from "./sandbox_live_fixture.ts";
import {
  COMMAND,
  containerTest,
  fakeLauncher,
  IMAGE,
  POSIX,
  withWallClock,
} from "./sandbox_runner_fixture.ts";

/**
 * Every container run carries the CLI's own syscall profile, on docker and podman alike: a file
 * written for the run in a folder of its own in the system's temporary folder, which nothing the
 * container runs can reach, named on the command line, and removed with the run.
 */

const ENGINES = ["docker", "podman"] as const;
const HOST_ENV = { PATH: "/usr/bin:/bin", HOME: "/home/dev" };

/** The profile a launch names after `--security-opt seccomp=`, and what that file held then. */
type Handed = { path: string; text: string | null; mode: number | null };

/** A fake launcher that also records, at the run's launch, the profile it is handed. */
function reading(code: number | null = 0) {
  const fake = fakeLauncher(code);
  const handed: Handed[] = [];
  const launcher: ProcessLauncher = {
    start(spec) {
      const opt = spec.args.find((a) => a.startsWith("seccomp="));
      if (opt !== undefined) handed.push(fileAt(opt.slice("seccomp=".length)));
      return fake.launcher.start(spec);
    },
    runSync: fake.launcher.runSync,
  };
  return { launcher, handed };
}

function fileAt(path: string): Handed {
  if (!exists(path)) return { path, text: null, mode: null };
  return { path, text: Deno.readTextFileSync(path), mode: Deno.statSync(path).mode };
}

const runner = (engine: typeof ENGINES[number], launcher: ProcessLauncher) =>
  new ContainerRunner(
    engine,
    IMAGE,
    launcher,
    { dropped: [], cpus: null },
    () => "specnaut-sandbox-p1",
    () => HOST_ENV,
  );

containerTest(
  "engine profile: each run on either engine is handed the CLI's profile, as written",
  async () => {
    for (const engine of ENGINES) {
      const { launcher, handed } = reading(0);
      await runner(engine, launcher).run(policyOf("container"), COMMAND);
      assertEquals(handed.length, 1, engine);
      assertEquals(JSON.parse(handed[0].text ?? "null"), seccompProfile(), engine);
    }
  },
);

Deno.test({
  name: "engine profile: the file is the user's alone, in a temporary folder of the run's own",
  ignore: !POSIX,
  fn: async () => {
    for (const engine of ENGINES) {
      const { launcher, handed } = reading(0);
      await runner(engine, launcher).run(policyOf("container"), COMMAND);
      assertEquals((handed[0].mode ?? 0) & 0o777, 0o600, engine);
      const folder = dirname(handed[0].path);
      const temp = Deno.env.get("TMPDIR") ?? "/tmp";
      assert(folder.startsWith(temp.replace(/\/$/, "")), `${folder} is not in ${temp}`);
      assert(!folder.startsWith(Deno.cwd()), `${folder} is in the working folder`);
    }
  },
});

containerTest(
  "engine profile: the run's profile and its folder go once the run is over, however it ends",
  async () => {
    for (const engine of ENGINES) {
      for (const code of [0, null]) {
        const { launcher, handed } = reading(code);
        await runner(engine, launcher).run(withWallClock(policyOf("container"), 0.01), COMMAND);
        assertEquals(exists(handed[0].path), false, `${engine}, a run ending with ${code}`);
        assertEquals(exists(dirname(handed[0].path)), false, `${engine}, ${code}`);
      }
    }
  },
);

Deno.test("engine profile: each run writes a profile of its own", async () => {
  const [first, second] = [await engineRunEnv("docker", {}), await engineRunEnv("docker", {})];
  try {
    assert(first.seccomp !== second.seccomp);
    assertEquals(JSON.parse(Deno.readTextFileSync(first.seccomp)), seccompProfile());
  } finally {
    first.release();
    second.release();
  }
});

Deno.test("engine profile: a run refused before its launch leaves nothing behind", async () => {
  const temp = await Deno.makeTempDir({ prefix: "specnaut-temp-" });
  try {
    await withEnv({ TMPDIR: temp }, async () => {
      const { launcher, handed } = reading(0);
      const unpinned = new ContainerRunner("docker", "acme/dev:latest", launcher, {
        dropped: [],
        cpus: null,
      });
      await assertRejects(
        () => unpinned.run(policyOf("container"), COMMAND),
        Error,
        "is not pinned by digest",
      );
      assertEquals(handed, []);
      assertEquals([...Deno.readDirSync(temp)], []);
    });
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
});
