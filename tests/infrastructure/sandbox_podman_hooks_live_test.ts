import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { live, LIVE_IMAGE, runIn, withEnv, withLayout } from "./sandbox_live_fixture.ts";
import { NO_LOCAL_PODMAN, plainPodman } from "./sandbox_podman_live.ts";

/**
 * A user's containers.conf can name a hooks folder, whose hook marked `when.always` runs around
 * every container podman starts, and add an annotation to every container, one a runtime may read
 * as an instruction. The sandbox's podman loads the CLI's containers.conf last, which empties both:
 * its run fires no hook and carries no annotation. A plain podman under the same configuration
 * shows the hook firing and seeing the annotation, so the file was read.
 */

const ANNOTATION = "io.specnaut.live-marker";
const NAME = `specnaut-hooks-live-${crypto.randomUUID().slice(0, 8)}`;

/** A containers.conf adding the hooks folder and the annotation to every container. */
function userConf(hooks: string): string {
  return [
    "[containers]",
    `annotations = [${JSON.stringify(`${ANNOTATION}=from-containers-conf`)}, {append=true}]`,
    "",
    "[engine]",
    `hooks_dir = [${JSON.stringify(hooks)}, {append=true}]`,
    "",
  ].join("\n");
}

/** An OCI hook for every container, appending the state it is given, annotations included. */
const hook = (marker: string) =>
  JSON.stringify({
    version: "1.0.0",
    hook: { path: "/bin/sh", args: ["sh", "-c", `cat >> '${marker}'`] },
    when: { always: true },
    stages: ["prestart"],
  });

/** The marker's text; none written yet reads as empty, and any other failure is thrown. */
const read = (path: string) =>
  Deno.readTextFile(path).catch((e) => {
    if (e instanceof Deno.errors.NotFound) return "";
    throw e;
  });

/** The annotations of the running container `name`, or `null` if it never showed up. */
async function annotationsOf(name: string): Promise<string | null> {
  for (let i = 0; i < 100; i++) {
    const r = await plainPodman([
      "container",
      "inspect",
      "--format",
      "{{json .Config.Annotations}}",
      name,
    ]);
    if (r.code === 0) return r.out;
    await new Promise((done) => setTimeout(done, 100));
  }
  return null;
}

Deno.test({
  name: live(
    "podman hooks live: a user's hooks and annotations reach no sandbox run",
    NO_LOCAL_PODMAN,
  ),
  ignore: NO_LOCAL_PODMAN !== null,
  fn: () =>
    withLayout("container", async ({ policy, scratch }) => {
      const hooks = join(scratch, "hooks.d");
      const marker = join(scratch, "hook-fired");
      await Deno.mkdir(hooks);
      await Deno.writeTextFile(join(hooks, "marker.json"), hook(marker));
      const conf = join(scratch, "containers.conf");
      await Deno.writeTextFile(conf, userConf(hooks));
      await withEnv({ CONTAINERS_CONF: conf }, async () => {
        const plain = ["run", "--rm", "--pull", "never", "--network", "none", LIVE_IMAGE, "true"];
        assertEquals((await plainPodman(plain)).code, 0, "a plain run failed");
        assertStringIncludes(await read(marker), ANNOTATION, "a plain run fired no hook");
        await Deno.remove(marker);
        const running = runIn(
          (l) =>
            new ContainerRunner("podman", LIVE_IMAGE, l, { dropped: [], cpus: null }, () => NAME),
          policy,
          ["/bin/sh", "-c", "echo start; sleep 3"],
        );
        const annotations = await annotationsOf(NAME);
        const { out } = await running;
        // Only the run's own shell prints it: a run that never started proves nothing.
        assert(out.startsWith("start\n"), `the run never started: ${out.slice(0, 200)}`);
        assert(annotations !== null, "the sandbox's container was never seen running");
        assert(!annotations.includes(ANNOTATION), `the annotation was set: ${annotations}`);
        assertEquals(await read(marker), "", "a hook fired around the sandbox's container");
      });
    }),
});
