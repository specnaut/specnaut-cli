import type { CoreBundle } from "../domain/core_bundle.ts";
import type { InstalledLock } from "../domain/installed_lock.ts";
import { SCRIPTS_DIR } from "../domain/script_trust.ts";
import type { Bundle } from "../domain/template.ts";
import type { BundleOptions } from "./bundle_options.ts";
import type { Harness } from "./ports.ts";

/**
 * How a lock maps the embedded bundle: the one home of the options a lock records and of the
 * bundle mapped through them, so `diff`, `upgrade` and the script check compare against the same
 * bytes a refresh would write.
 */

/** The install options a lock records, as the bundle mapper takes them. */
export function bundleOptionsOf(lock: InstalledLock): BundleOptions {
  return {
    backlogBackend: lock.backlogBackend,
    versionScheme: lock.versionScheme,
    specBackend: lock.specBackend,
    specAutogen: lock.specAutogen,
  };
}

/** The bundle mapped through the lock's harness and options; `null` when no harness has its key. */
export function bundleForLock(
  core: CoreBundle,
  lock: InstalledLock,
  findHarness: (key: string) => Harness | null,
): Bundle | null {
  const harness = findHarness(lock.harness);
  return harness === null ? null : harness.mapBundle(core, bundleOptionsOf(lock));
}

/** The bundle's regular files under the scripts folder, by destination: what the script check reads. */
export function bundledScripts(bundle: Bundle): Map<string, string> {
  const files = new Map<string, string>();
  for (const [dest, entry] of Object.entries(bundle)) {
    if (dest.startsWith(`${SCRIPTS_DIR}/`) && entry.symlinkTo === undefined) {
      files.set(dest, entry.content);
    }
  }
  return files;
}
