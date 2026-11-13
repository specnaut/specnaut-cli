import { dirname } from "@std/path";
import type { ProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { HdiutilVolumes } from "../../src/infrastructure/sandbox_scratch_volume.ts";

/** What the scratch volume tests share: hdiutil and the host standing in, and a mount to use. */

export const HDIUTIL = "/usr/bin/hdiutil";
export const MIB = 1024 ** 2;

/** How one hdiutil call ends: its exit code and what it wrote to its outputs. */
export type End = { readonly code: number; readonly stdout?: string; readonly stderr?: string };

/** What `hdiutil attach -plist` answers for an image attached as `disk`: its slices, a container. */
export const attachAnswer = (disk: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n` +
  `\t<key>system-entities</key>\n\t<array>\n` +
  [disk, `${disk}s1`, "/dev/disk99", "/dev/disk99s1"].map((dev) =>
    `\t\t<dict>\n\t\t\t<key>dev-entry</key>\n\t\t\t<string>${dev}</string>\n\t\t</dict>\n`
  ).join("") + `\t</array>\n</dict>\n</plist>\n`;

/**
 * A launcher standing in for hdiutil: each call ends as the next of `ends[<verb>]` says (a detach
 * forced is `detach -force`, one the exit trap runs synchronously `sync`), else with 0, an attach
 * answering it made `/dev/disk9`; `missing` makes every start throw.
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
      const said = end.stdout ?? (verb === "attach" ? attachAnswer("/dev/disk9") : "");
      const [stdout, stderr] = [Promise.resolve(said), Promise.resolve(end.stderr ?? "")];
      return { pid: 1, ended, exited: ended, stdout, stderr, stop() {}, release() {} };
    },
    runSync(spec) {
      synced.push([spec.cmd, ...spec.args]);
      return ends["sync"]?.shift()?.code ?? 0;
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
    mounted: () => answer(),
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

/** Every line `fn` wrote through `console.error`, which is kept from the test's output. */
export function warnings(fn: () => void): string[] {
  const warned: string[] = [];
  const real = console.error;
  console.error = (line: string) => void warned.push(line);
  try {
    fn();
  } finally {
    console.error = real;
  }
  return warned;
}

/** {@link warnings}, for an `fn` that is done once its promise settles. */
export async function warningsOf(fn: () => Promise<unknown>): Promise<string[]> {
  const warned: string[] = [];
  const real = console.error;
  console.error = (line: string) => void warned.push(line);
  try {
    await fn();
  } finally {
    console.error = real;
  }
  return warned;
}
