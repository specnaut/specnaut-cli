/** The label lines of a gate report, which every gate-impact test reads. */

const LABELS = /^(candidate|scope|fallback|removed|omitted|ran|evidence): /;

export function reportOf(stdout: string): string[] {
  return stdout.replaceAll("\r\n", "\n").split("\n").filter((l) => LABELS.test(l))
    .map((l) => l.startsWith("evidence: ") && !l.includes("unwritten") ? "evidence: written" : l);
}

/** The value of each line with this label. */
export const labelled = (r: { report: string[] }, label: string) =>
  r.report.filter((l) => l.startsWith(`${label}: `)).map((l) => l.slice(label.length + 2));
