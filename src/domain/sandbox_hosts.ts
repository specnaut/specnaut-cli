/**
 * What each backend's host offers a sandboxed gate: the system folders, devices and macOS services
 * a toolchain reads there. Data only: `sandboxPolicy` in `sandbox.ts` decides which of it a policy
 * carries, and is the one home of what a sandbox may touch.
 */

/**
 * macOS services a sandboxed process may never look up: each reads or acts on the user's
 * session (the keychain's secrets, opening apps, scripting them, the clipboard). Launchd job
 * submission is an operation, not a service: the profile denies `job-creation` instead.
 */
export const FORBIDDEN_SERVICES = {
  keychain: ["com.apple.SecurityServer", "com.apple.securityd"],
  launchServices: ["com.apple.coreservices.launchservicesd", "com.apple.lsd.mapdb"],
  appleEvents: ["com.apple.coreservices.appleevents"],
  pasteboard: ["com.apple.pasteboard.1"],
} as const;

/** The macOS services a gate may look up: user and group lookups (`id`, git's author). */
export const ALLOWED_SERVICES: readonly string[] = ["com.apple.system.opendirectoryd.libinfo"];

/** The files under `/etc` a Linux toolchain reads: the loader's cache, the zone, user lookups. */
const LINUX_ETC = ["alternatives", "ld.so.cache", "localtime", "passwd", "group", "nsswitch.conf"]
  .map((name) => `/etc/${name}`);

/** Read-only system folders per host; a listed folder the host lacks is skipped. */
export const SYSTEM = {
  bwrap: ["/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", ...LINUX_ETC],
  seatbelt: [
    "/usr",
    "/bin",
    "/sbin",
    "/System",
    "/Library/Developer/CommandLineTools",
    "/private/etc",
    "/private/var/db/timezone",
    "/private/var/select",
  ],
  container: [],
} as const;

export const SYSTEM_PATH = ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
export const DEVICES = ["/dev/null", "/dev/zero", "/dev/random", "/dev/urandom"];

/** On macOS the loader reads the root folder's own listing (its names, nothing beneath it). */
export const SEATBELT_LISTINGS: readonly string[] = ["/"];
