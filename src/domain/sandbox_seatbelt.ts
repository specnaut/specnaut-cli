/**
 * The `sandbox-exec` profile for a {@link SandboxPolicy}, macOS's backend when no container runs.
 *
 * It denies by default and allows what the policy names. The profile language applies the last
 * rule that matches, so it closes with denies that no allow above them can reopen: all network
 * (the host's loopback and unix sockets included, since this backend shares the host's network
 * stack — a test that needs loopback cannot pass here), launchd job submission, and every
 * forbidden service by name. Pure — the caller writes the profile and runs `sandbox-exec`.
 */

import type { SandboxPolicy } from "./sandbox.ts";
import { FORBIDDEN_SERVICES } from "./sandbox_hosts.ts";
import { safePath } from "./sandbox_paths.ts";

/** The profile text, one rule per line. */
export function seatbeltProfile(policy: SandboxPolicy): string {
  const folders = [...policy.system, ...policy.reads, ...policy.writes];
  const forbidden = Object.values(FORBIDDEN_SERVICES).flat();
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    "(allow process-exec)",
    "(allow signal (target same-sandbox))",
    "(allow process-info* (target same-sandbox))",
    "(allow sysctl-read)",
    // Resolving a path stats every folder on the way; this reveals that a file exists, not
    // what it holds. The loader also lists the root folder itself (its names, nothing beneath).
    "(allow file-read-metadata)",
    '(allow file-read-data (literal "/"))',
    `(allow file-read* ${rules("subpath", folders)})`,
    `(allow file-read* file-write* ${rules("literal", policy.devices)})`,
    `(allow file-write* ${rules("subpath", policy.writes)})`,
    ...(policy.services.length > 0
      ? [`(allow mach-lookup ${policy.services.map(service).join(" ")})`]
      : []),
    "(deny network*)",
    "(deny job-creation)",
    `(deny mach-lookup ${forbidden.map(service).join(" ")})`,
    "",
  ].join("\n");
}

function rules(kind: "subpath" | "literal", paths: readonly string[]): string {
  return paths.map((p) => `(${kind} "${safePath(p)}")`).join(" ");
}

function service(name: string): string {
  return `(global-name "${name}")`;
}
