import { bold, cyan, dim } from "@std/fmt/colors";
import { upgradeReleaseNotes } from "../../application/upgrade_release_notes.ts";
import type { AppliedResult, UpToDateResult } from "../../application/upgrade_run.ts";
import type { ReleaseNotes } from "../../domain/release_notes.ts";
import { RELEASE_HISTORY, TEMPLATES_VERSION } from "../../templates_bundle.ts";

/**
 * The lines `specnaut upgrade` prints about the releases it crossed (cli#759).
 * The highlights are printed as published: the bundler already refused any
 * character they may not hold, so nothing is cleaned here. Only trailing
 * newlines go, for the layout.
 */
export function releaseNotesLines(notes: ReleaseNotes): string[] {
  if (notes.kind === "no-change") return [dim("No version change — no release notes to show.")];
  if (notes.kind === "none") return [];
  if (notes.releases.length === 0 && notes.recordedSince === null) return [];
  const lines = ["", bold("What's new in the releases this upgrade crossed:")];
  if (notes.recordedSince !== null) {
    lines.push(dim(`Releases before v${notes.recordedSince} published no highlights.`));
  }
  for (const release of notes.releases) {
    lines.push(
      "",
      cyan(`── v${release.version}`),
      release.highlights?.replace(/\n+$/, "") ?? dim("No highlights for this release."),
      dim(`Full notes: ${release.url}`),
    );
  }
  return lines;
}

/**
 * Prints the notes for an applied or up-to-date run, from what this binary
 * carries. Called after the run's outcome is printed: what the notes say never
 * changes the exit code or a written file (FR-008).
 */
export function printReleaseNotes(result: Pick<AppliedResult | UpToDateResult, "fromVersion">) {
  const binary = { templatesVersion: TEMPLATES_VERSION, history: RELEASE_HISTORY };
  for (const line of releaseNotesLines(upgradeReleaseNotes(result, binary))) console.log(line);
}
