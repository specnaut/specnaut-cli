/**
 * Which of the bootstrap's principles a project's constitution does not carry
 * (spec 038, US3). Upgrade never edits `docs/constitution.md`, so a project
 * whose file predates a default principle hears about it once per run, and
 * decides.
 *
 * The principles are read from the bootstrap itself — each `## ` heading and
 * the `Check:` lines under it — never from a list kept here, which would be a
 * second copy of the bootstrap to drift from it.
 */

export type Principle = { readonly name: string; readonly checks: readonly string[] };

/** `##` sections of the bootstrap that carry at least one `Check:` line. */
export function bootstrapPrinciples(bootstrap: string): Principle[] {
  return bootstrap.replaceAll("\r\n", "\n").split(/^## /m).slice(1).flatMap((section) => {
    const [heading, ...body] = section.split("\n");
    const checks = body.filter((l) => l.startsWith("Check:"));
    return checks.length > 0 ? [{ name: heading.trim(), checks }] : [];
  });
}

/**
 * The names of the bootstrap principles `project` does not carry, in the
 * bootstrap's order.
 *
 * A principle counts as adopted when one of its `Check:` lines, or its
 * heading at any level, is present — ignoring case and whitespace (A-L2). A
 * team that reworded the heading but kept the check has adopted it; so has
 * one that kept the heading and wrote its own checks. Matching exact heading
 * text alone would nag both.
 */
export function missingPrinciples(bootstrap: string, project: string): string[] {
  const flat = norm(project);
  const headings = new Set(
    project.replaceAll("\r\n", "\n").split("\n")
      .filter((l) => /^#{1,6}\s/.test(l))
      .map((l) => norm(l.replace(/^#+/, ""))),
  );
  return bootstrapPrinciples(bootstrap)
    .filter((p) => !headings.has(norm(p.name)) && !p.checks.some((c) => flat.includes(norm(c))))
    .map((p) => p.name);
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
