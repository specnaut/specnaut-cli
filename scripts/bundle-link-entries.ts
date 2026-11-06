/**
 * The bundler's checks on context-link entries (cli#680, cli#681). Out of
 * `bundle-templates.ts`, which is over its size target.
 */

import { linkTargetPath } from "../src/domain/context_link.ts";

/** The fields of a `harness_static` manifest entry a link check reads. */
export type LinkEntry = {
  harness: string;
  destination: string;
  source?: string;
  mergeJson?: unknown;
  link?: string;
  fallback?: string;
};

/**
 * What is wrong with a link entry, or nothing. A context link exists to point
 * at the project's own root file, so its text must be relative and land on a
 * core `project-root` destination; its fallback is a single line, because a
 * harness reads it as an always-on file. An entry with a `source` as well is
 * two definitions of one destination.
 */
export function linkEntryProblems(
  e: LinkEntry,
  projectRootSuffixes: ReadonlySet<string>,
): string[] {
  if (e.link === undefined) return [];
  const at = `${e.harness}:${e.destination}`;
  const problems: string[] = [];
  if (e.source !== undefined || e.mergeJson !== undefined) {
    problems.push(`${at} has a link and a source`);
  }
  if (e.link.startsWith("/") || /^[A-Za-z]:/.test(e.link)) {
    problems.push(`${at} link is absolute: ${e.link}`);
  } else if (!projectRootSuffixes.has(linkTargetPath(e.destination, e.link))) {
    problems.push(`${at} link ${e.link} does not land on a project-root file`);
  }
  if (e.fallback === undefined || e.fallback === "" || e.fallback.includes("\n")) {
    problems.push(`${at} needs a one-line fallback`);
  }
  return problems;
}

export function assertLinkEntries(
  core: ReadonlyArray<{ category: string; suffix?: string }>,
  harnessStatic: ReadonlyArray<LinkEntry>,
): void {
  const roots = new Set(
    core.filter((e) => e.category === "project-root" && e.suffix).map((e) => e.suffix!),
  );
  const problems = harnessStatic.flatMap((e) => linkEntryProblems(e, roots));
  if (problems.length > 0) {
    throw new Error(`Invalid context-link entries:\n  - ${problems.join("\n  - ")}`);
  }
}
