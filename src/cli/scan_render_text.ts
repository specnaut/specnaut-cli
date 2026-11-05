import { SIZE_UNITS } from "../domain/size_limits.ts";
import type {
  Count,
  FileFinding,
  FolderMeasure,
  HotSpot,
  Ranked,
  ScanReport,
  ScanTotals,
  UnitFinding,
} from "../domain/structural_scan_types.ts";
import { TREE_DEPTH } from "../domain/structural_scan.ts";
import { terminalText } from "../domain/terminal_text.ts";

/**
 * The scan as text for a person or an agent. Every path and name goes through `terminalText`, and
 * the two statements open it. "Language not read" is worded as what it is: the estimator has no
 * grammar for the file, plain files such as LICENSE included. It says nothing about the file.
 */
export function renderScanText(r: ScanReport): string {
  const out = [`specnaut scan: ${r.statements.map}`, r.statements.data];
  out.push(`Scope: ${r.path === null ? "the whole repository" : terminalText(r.path)}`, "");
  out.push(`Limits: ${limitsLine(r)}`, "", ...totalsLines(r.totals), "");
  section(out, "Hot spots", r.hotSpots, hotSpotLine);
  section(out, "Files over a limit", r.files, fileLine);
  section(out, "Functions over a limit (estimated)", r.functions, unitLine);
  section(out, "Classes over a limit (estimated)", r.classes, unitLine);
  section(out, "Most crowded folders, by files", r.foldersByFiles, folderLine);
  section(out, "Heaviest folders, by lines", r.foldersByLines, folderLine);
  section(
    out,
    `Folder tree, depth ${TREE_DEPTH}`,
    r.tree,
    (n) => `${"  ".repeat(n.depth)}${terminalText(n.path)}  ${n.files} files, ${n.lines} lines`,
  );
  return out.join("\n").trimEnd();
}

function limitsLine(r: ScanReport): string {
  const text = (n: number | null) => n === null ? "none" : String(n);
  return SIZE_UNITS.map((u) => {
    const l = r.limits[u];
    return `${u} ${text(l.target)}/${text(l.ceiling)} (${l.source})`;
  }).join(", ");
}

const NAMES: Readonly<Record<string, string>> = {
  specnaut: ".specnaut/",
  installed_lock: "installed.lock",
  exempt_glob: "exempt glob",
  undecodable_name: "name not UTF-8",
  code_not_read: "language not read",
};

function counts(c: Count<string>): string {
  return Object.entries(c).map(([k, n]) => `${NAMES[k] ?? k.replaceAll("_", " ")} ${n}`).join(", ");
}

function totalsLines(t: ScanTotals): string[] {
  const over = (u: keyof ScanTotals["over"]) =>
    `${u} ${t.over[u].over_target} over target, ${t.over[u].over_ceiling} over ceiling`;
  const notAnalysed = t.measured - t.analysed;
  return [
    "Totals",
    `  tracked ${t.tracked}: measured ${t.measured}, exempt ${t.exempt}, skipped ${t.skipped}, missing ${t.missing}`,
    `  exempt: ${counts(t.exemptBy)}`,
    `  skipped: ${counts(t.skippedBy)}`,
    `  measured ${t.lines} lines: analysed ${t.analysed}, not analysed ${notAnalysed} (${
      counts(t.notAnalysedBy)
    })`,
    `  units (estimated): ${t.units.functions} functions, ${t.units.classes} classes, ${t.units.unnamed} unnamed`,
    `  over a limit: ${over("file")}; ${over("constitution")}`,
    `  over a limit (estimated): ${over("function")}; ${over("class")}`,
  ];
}

function section<T>(out: string[], title: string, list: Ranked<T>, line: (t: T) => string) {
  const shown = list.items.length < list.total
    ? `${list.items.length} of ${list.total}`
    : `${list.total}`;
  out.push(`${title} (${shown})`);
  out.push(...(list.items.length === 0 ? ["  none"] : list.items.map((t) => `  ${line(t)}`)), "");
}

const levelText = (f: FileFinding | UnitFinding) =>
  `${f.level === "over_ceiling" ? "over ceiling" : "over target"} ${f.limit} (${f.source})`;

function fileLine(f: FileFinding): string {
  const unit = f.unit === "constitution" ? ", constitution" : "";
  return `${terminalText(f.path)}  ${f.lines} lines  ${levelText(f)}${unit}`;
}

function unitLine(u: UnitFinding): string {
  const name = u.name === null ? "(unnamed)" : terminalText(u.name);
  return `${terminalText(u.path)}:${u.startLine}  ${u.kind} ${name}  ${u.lines} lines  ${
    levelText(u)
  }`;
}

function folderLine(f: FolderMeasure): string {
  return `${terminalText(f.path)}  ${f.files} files, ${f.lines} lines`;
}

function hotSpotLine(h: HotSpot): string {
  if (h.kind === "file") return `file      ${fileLine(h)}`;
  if (h.kind === "folder") return `folder    ${folderLine(h)}`;
  return `${h.kind.padEnd(10)}${unitLine(h)} (estimated)`;
}
