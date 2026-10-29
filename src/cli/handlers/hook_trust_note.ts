import { dim, yellow } from "@std/fmt/colors";
import type { Harness } from "../../application/ports.ts";
import type { UpgradeProjectResult } from "../../application/upgrade_project.ts";
import { hookTrustCovers, hookTrustDue, registeredHooks } from "../../domain/hook_trust.ts";
import { DenoFsReader } from "../../infrastructure/fs_reader.ts";

/**
 * The hook-trust note `init` and `upgrade` print (US6, FR-012), written once
 * for both: a harness whose hooks stay off until trusted gets told so whenever
 * a run changed what it hashes, with the list of what it is about to trust.
 */

/** Where the note is about: the project, and its harness (`null` when unknown). */
export type HookTrustTarget = {
  readonly harness: Pick<Harness, "displayName" | "hookTrust"> | null;
  readonly projectDir: string;
};

/** A foreign command is shown, not executed — a long one is cut to keep its line readable. */
const MAX_COMMAND = 100;

/**
 * Print the note when `changed` touches a trusted path, then one line per file
 * the run `kept` customized there: such a file no longer matches `SHA256SUMS`,
 * so every pinned command refuses — trusting changes nothing until it is restored.
 */
export async function printHookTrustNote(
  target: HookTrustTarget,
  changed: Iterable<string>,
  kept: Iterable<string> = [],
): Promise<void> {
  const { harness, projectDir } = target;
  const trust = harness?.hookTrust;
  if (harness === null || trust === undefined) return;
  if (hookTrustDue(trust, changed)) {
    const registry = await new DenoFsReader().readText(projectDir, trust.registry);
    const hooks = registeredHooks(registry, trust.registry);
    console.log(yellow(`\n⚠ ${trust.note}`));
    if (hooks.specnaut.length > 0) {
      console.log(dim(`    Specnaut's hooks: ${hooks.specnaut.join(", ")}`));
    }
    for (const command of hooks.foreign) {
      const shown = command.length > MAX_COMMAND ? `${command.slice(0, MAX_COMMAND)}…` : command;
      console.log(yellow(`    ⚠ ${shown} — not installed by Specnaut — review before trusting`));
    }
  }
  for (const dest of kept) {
    if (!hookTrustCovers(trust, dest)) continue;
    console.log(yellow(
      `⚠ ${dest} is customized: ${harness.displayName} will refuse to run any ` +
        "Specnaut hook until the folder matches its SHA256SUMS again " +
        "(`specnaut upgrade --force` restores it).",
    ));
  }
}

/**
 * The upgrade's side: what it changed is every merge that changed plus, on a
 * run that wrote, every file it wrote; what it kept is each file the plan left
 * as found on disk (customized or declared) and the run did not overwrite.
 */
export function printUpgradeHookTrust(
  target: HookTrustTarget,
  result: Extract<UpgradeProjectResult, { status: "up-to-date" | "applied" }>,
): Promise<void> {
  if (result.status === "up-to-date") return printHookTrustNote(target, result.mergedChanged);
  const written = new Set(result.written);
  const kept = result.plan.filter((a) => a.kind === "preserve" && !written.has(a.dest));
  return printHookTrustNote(
    target,
    [...result.mergedChanged, ...written],
    kept.map((a) => a.dest),
  );
}
