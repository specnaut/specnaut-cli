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
import type { Sysctls } from "./sandbox_hosts.ts";
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
    `(allow sysctl-read ${sysctlRules(policy.sysctls)})`,
    `(allow file-read-metadata ${rules("literal", policy.lookups)})`,
    `(allow file-read-data ${rules("literal", policy.listings)})`,
    `(allow file-read* ${rules("subpath", folders)})`,
    `(allow file-read* file-write* ${rules("literal", policy.devices)})`,
    `(allow file-write* ${rules("subpath", policy.writes)})`,
    ...(policy.services.length > 0
      ? [`(allow mach-lookup ${policy.services.map(service).join(" ")})`]
      : []),
    networkRule(policy.network),
    "(deny job-creation)",
    `(deny mach-lookup ${forbidden.map(service).join(" ")})`,
    "",
  ].join("\n");
}

/**
 * The filters of one rule. An allow with no filter would apply to every path, so an empty list
 * throws rather than widen it. Only a `literal` may name the root folder: it means that one entry.
 */
function rules(kind: "subpath" | "literal", paths: readonly string[]): string {
  if (paths.length === 0) throw new Error(`a seatbelt rule needs at least one ${kind}`);
  const quoted = (p: string) => (kind === "literal" && p === "/" ? p : safePath(p));
  return paths.map((p) => `(${kind} "${quoted(p)}")`).join(" ");
}

function service(name: string): string {
  return `(global-name "${name}")`;
}

/** `none` shuts the host's whole network stack, loopback and unix sockets included. */
function networkRule(network: SandboxPolicy["network"]): string {
  switch (network) {
    case "none":
      return "(deny network*)";
  }
}

/** A kernel value's name: dotted words, nothing that could close the rule's quotes. */
const SYSCTL_NAME = /^[a-z0-9_]+(\.[a-z0-9_]+)*\.?$/;

/** The named kernel values; like a file rule, an empty list throws rather than allow them all. */
function sysctlRules({ names, prefixes }: Sysctls): string {
  const all = [...names, ...prefixes];
  if (all.length === 0) throw new Error("a seatbelt sysctl rule needs at least one name");
  const odd = all.find((n) => !SYSCTL_NAME.test(n));
  if (odd !== undefined) throw new Error(`sysctl name ${JSON.stringify(odd)} is not plain`);
  return [
    ...names.map((n) => `(sysctl-name "${n}")`),
    ...prefixes.map((p) => `(sysctl-name-prefix "${p}")`),
  ].join(" ");
}
