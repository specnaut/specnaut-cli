import { dirname } from "@std/path";
import type { ProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { HdiutilVolumes } from "../../src/infrastructure/sandbox_scratch_volume.ts";

/** What the scratch volume tests share: hdiutil and the host standing in, and a mount to use. */

export const HDIUTIL = "/usr/bin/hdiutil";
export const MIB = 1024 ** 2;

/** How one hdiutil call ends: its exit code and what it wrote to its standard error. */
export type End = { readonly code: number; readonly stderr?: string };

/**
 * A launcher standing in for hdiutil: each call ends as the next of `ends[<verb>]` says (a detach
 * forced is `detach -force`), else with 0; `missing` makes every start throw.
 */
export function hdiutil(ends: Record<string, End[]> = {}, missing = false) {
  const calls: string[][] = [];
  const synced: string[][] = [];
  const launcher: ProcessLauncher = {
    start(spec) {
      if (missing) throw new Deno.errors.NotFound(`no ${spec.cmd}`);
      calls.push([spec.cmd, ...spec.args]);
      const verb = spec.args.includes("-force") ? `${spec.args[0]} -force` : spec.args[0];
      const end = ends[verb]?.shift() ?? { code: 0 };
      const ended = Promise.resolve(end.code);
      const stderr = Promise.resolve(end.stderr ?? "");
      return { pid: 1, ended, exited: ended, stderr, stop() {}, release() {} };
    },
    runSync(spec) {
      synced.push([spec.cmd, ...spec.args]);
      return 0;
    },
  };
  return { launcher, calls, synced };
}

/**
 * A host whose mount point is mounted as `state.mounted` answers, in turn, the last answer kept;
 * its exit traps are kept, not armed.
 */
export function host(mounted: boolean) {
  const state = { mounted: [mounted], disarmed: 0 };
  const traps: (() => void)[] = [];
  const answer = () => state.mounted.length > 1 ? state.mounted.shift()! : state.mounted[0];
  const volumeHost = {
    mounted: () => Promise.resolve(answer()),
    arm: (cleanup: () => void) => {
      traps.push(cleanup);
      return () => void state.disarmed++;
    },
  };
  return { volumeHost, traps, state };
}

/** The image folder the create call named: the parent of the image's base name. */
export const imageFolder = (calls: string[][]) => dirname(calls[0].at(-1)!);

/** `fn` given a real, empty folder to mount on, open to all at first, removed after it. */
export async function onMount(fn: (mount: string) => Promise<void>): Promise<void> {
  const mount = await Deno.realPath(await Deno.makeTempDir({ prefix: "specnaut-mount-" }));
  await Deno.chmod(mount, 0o755);
  try {
    await fn(mount);
  } finally {
    await Deno.remove(mount, { recursive: true });
  }
}

/**
 * An attached volume on a fresh mount whose detaches end as `ends` say, the mount then mounted as
 * `mounted` answers in turn.
 */
export async function detaching(ends: Record<string, End[]>, mounted: boolean[]) {
  const mount = await Deno.realPath(await Deno.makeTempDir({ prefix: "specnaut-mount-" }));
  const { launcher, calls, synced } = hdiutil(ends);
  const { volumeHost, traps, state } = host(true);
  const volume = await new HdiutilVolumes(launcher, volumeHost).attach(mount, 8 * MIB);
  state.mounted = [...mounted];
  const folder = imageFolder(calls);
  const detaches = () => calls.slice(2).map((c) => c.slice(1).join(" "));
  const cleanup = () => Deno.remove(mount, { recursive: true });
  return { volume, folder, detaches, synced, traps, state, cleanup, mount };
}
