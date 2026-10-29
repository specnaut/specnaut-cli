import { bold, cyan, dim } from "@std/fmt/colors";
import type { BacklogBackend, KnownHarness } from "../../domain/installed_lock.ts";
import { harnessCommands } from "../../infrastructure/harness/harness_commands.ts";
import type { Harness } from "../../application/ports.ts";
import { printHookTrustNote } from "./hook_trust_note.ts";

/** What this init run put on disk: the trust note is due when it touched a hashed hook path. */
type InitRun = {
  readonly targetDir: string;
  readonly written: ReadonlyArray<string>;
  readonly mergedChanged: ReadonlyArray<string>;
};

/**
 * The guidance `specnaut init` closes on: what to type first in the harness
 * the user just chose, the hook-trust note when that harness needs one, then
 * the Specnaut Cloud pointer.
 *
 * Named for that harness, not for Claude. See `harness_commands.ts` — the
 * previous version printed `/specnaut plan` and `/board add` everywhere, and
 * both are wrong on most harnesses.
 */
export async function printInitNextSteps(
  harnessKey: KnownHarness,
  harness: Pick<Harness, "displayName" | "hookTrust">,
  backlogBackend: BacklogBackend,
  run: InitRun,
): Promise<void> {
  const { displayName } = harness;
  const cmd = harnessCommands(harnessKey);
  console.log("\nNext steps:");
  if (!cmd.invocable) {
    // Copilot applies `.github/instructions/` by context; there is nothing to type.
    console.log(
      `  1. Open the project in ${displayName} — Specnaut's instructions ` +
        `apply automatically from ${bold(".github/instructions/")}`,
    );
    console.log(
      `  2. Edit ${bold("AGENTS.md")} and refine ${
        bold(".specnaut/memory/constitution.md")
      } for your stack`,
    );
    console.log(
      `  3. Ask your agent to plan a feature — it will follow the Specnaut chain`,
    );
  } else {
    console.log(
      `  1. Open the project in ${displayName}, then run ${
        bold(cmd.skillDoc("specnaut", "constitution"))
      } to scaffold your project's guiding principles`,
    );
    console.log(
      `  2. Edit ${bold("AGENTS.md")} and refine ${
        bold(".specnaut/memory/constitution.md")
      } for your stack`,
    );
    console.log(
      `  3. Run ${
        bold(`${cmd.skillDoc("specnaut", "plan")} "<feature description>"`)
      } to plan your first feature`,
    );
    console.log(
      `  4. Use ${bold(`${cmd.skill("board")} add "<task title>"`)} for follow-up work`,
    );
  }
  await printHookTrustNote(
    { harness, projectDir: run.targetDir },
    [...run.written, ...run.mergedChanged],
  );
  printCloudPointer(backlogBackend);
}

/**
 * Specnaut Cloud funnel: point CLI users at the hosted product once they've
 * scaffolded — run headless + remote-control the agent's checkpoints. The
 * headless/remote pitch is worth showing regardless of backend, but when the
 * user already picked the cloud backlog backend the cloud strategy has already
 * emitted the `specnaut cloud login` CTA — so we drop the duplicate login line
 * here and just point at the site, keeping the call-to-action to once (#407).
 */
function printCloudPointer(backlogBackend: BacklogBackend): void {
  console.log(
    `\n${cyan("✦ Specnaut Cloud")} — run Specnaut headless and answer your agent from your phone:`,
  );
  console.log(
    dim(
      "     approve plans, answer clarifications & sign off merges remotely · hosted backlog + team roles.",
    ),
  );
  console.log(
    backlogBackend === "cloud"
      ? `     Learn more: ${cyan("https://specnaut.com")}`
      : `     Start free: ${bold("specnaut cloud login")} ${dim("·")} ${
        cyan("https://specnaut.com")
      }`,
  );
}
