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
 * kept out of the Finder and Spotlight, mounted on the scratch folder itself.
 */
export const attachArgs = (
  mount: string,
  image: string,
) => ["attach", "-owners", "on", "-nobrowse", "-noautoopen", "-mountpoint", mount, image];
