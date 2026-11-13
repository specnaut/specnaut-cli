/**
 * What `sandbox_scratch_volume.ts` asks of hdiutil, as words: the image's creation, its attach, and
 * the removal the run's watchdog runs when we were killed with SIGKILL.
 */

export const HDIUTIL = "/usr/bin/hdiutil";
const MIB = 1024 ** 2;

/**
 * The watchdog's removal, `$1` the mount, `$2` the image's folder, `$3` hdiutil. The forced detach
 * runs only on a mount point (another device than the folder above it): on a plain folder it
 * would detach the volume holding that folder. hdiutil's word is not read, as the image is
 * deleted either way; a volume that is somehow still attached is gone at the next restart.
 */
export const REMOVAL = 'd=$(/usr/bin/stat -f %d "$1") && p=$(/usr/bin/stat -f %d "$1/..") && ' +
  '[ "$d" != "$p" ] && "$3" detach -force "$1"; /bin/rm -rf -- "$2"';

/**
 * The image's creation: the policy's size rounded up to whole MiB. APFS keeps part of the image
 * for its own metadata, so a run gets somewhat less room than that size, never more.
 */
export const createArgs = (base: string, bytes: number) => [
  ...["create", "-size", `${Math.ceil(bytes / MIB)}m`, "-type", "SPARSE", "-fs", "APFS"],
  ...["-volname", "specnaut-scratch", base],
];

/**
 * The attach: owners honoured, so the root's mode keeps other users out as the folder's did,
 * kept out of the Finder and Spotlight, mounted on the scratch folder itself. Its answer is a
 * property list naming the disks it made (`attachedDisk`).
 */
export const attachArgs = (mount: string, image: string) => [
  ...["attach", "-plist", "-owners", "on", "-nobrowse", "-noautoopen"],
  ...["-mountpoint", mount, image],
];

/** Each innermost `<dict>` of a property list: one entity of an attach's answer. */
const ENTITY = /<dict>((?:(?!<\/?dict>)[\s\S])*)<\/dict>/g;

/**
 * The image's own disk in an attach's answer: the entity whose `dev-entry` names a whole disk
 * (`/dev/diskN`) and whose `content-hint` is a partition scheme (`GUID_partition_scheme` for the
 * images made here). The APFS container hdiutil makes on the image's slice is a whole disk too,
 * hinted by APFS's container type; the answer's order is not relied on to tell them apart. The
 * image's disk takes its slices and that container with it on a detach. `null` when the answer
 * names no such disk.
 */
export function attachedDisk(answer: string): string | null {
  for (const [, entity] of answer.matchAll(ENTITY)) {
    const dev = stringOf(entity, "dev-entry") ?? "";
    const hint = stringOf(entity, "content-hint") ?? "";
    if (/^\/dev\/disk[0-9]+$/.test(dev) && hint.endsWith("_partition_scheme")) return dev;
  }
  return null;
}

/** The string `key` holds in `entity`, or `null`. */
function stringOf(entity: string, key: string): string | null {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(entity)?.[1] ?? null;
}
