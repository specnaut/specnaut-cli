// Deprecated-alias detection for the specflow→specnaut rebrand.
//
// When the binary is still installed under the old name `specflow`, we warn
// once per invocation and proceed — muscle-memory keeps working for one release
// while users migrate to `specnaut`. The signal is the running executable's
// file name, so it never fires under `deno run src/main.ts` (dev/tests).

/** True when the running executable's file name is the deprecated `specflow`. */
export function isLegacyInvocation(execPath: string): boolean {
  const base = execPath.split(/[/\\]/).pop() ?? "";
  return base === "specflow" || base === "specflow.exe";
}

/** Stderr notice shown when invoked via the deprecated `specflow` binary. */
export const LEGACY_INVOCATION_WARNING =
  "warning: the 'specflow' command is deprecated — use 'specnaut' instead. " +
  "Run 'specnaut self-update' (or reinstall) to get the renamed binary; " +
  "the 'specflow' alias will be removed in the next major release.";
