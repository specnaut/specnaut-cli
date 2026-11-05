import { identifierOrNull } from "../domain/code_units/code_unit.ts";
import { folderOf } from "../domain/structural_scan.ts";
import type {
  FileFinding,
  FolderMeasure,
  HotSpot,
  Ranked,
  ScanReport,
  ScanTotals,
  TreeNode,
  UnitFinding,
} from "../domain/structural_scan_types.ts";
import { mermaidLabel, terminalJson } from "../domain/terminal_text.ts";
import type { ScanIntent } from "./intent.ts";
import { renderScanText } from "./scan_render_text.ts";

/**
 * A scan report in one format. The JSON is a public contract (`schema_version: 1`), held by a
 * golden test: its fields are shaped here, never by the text format (plan A18).
 */
export function renderScan(report: ScanReport, format: ScanIntent["format"]): string {
  if (format === "json") return terminalJson(scanJson(report));
  return format === "mermaid" ? scanMermaid(report) : renderScanText(report);
}

const SCAN_SCHEMA_VERSION = 1;

/** The JSON document: every list cut at `--top`, with `truncated` saying how much was left out. */
function scanJson(r: ScanReport) {
  return {
    schema_version: SCAN_SCHEMA_VERSION,
    statements: r.statements,
    path: r.path,
    limits: r.limits,
    totals: totalsJson(r.totals),
    hot_spots: listJson(r.hotSpots, hotSpotJson),
    files: listJson(r.files, fileJson),
    functions: listJson(r.functions, unitJson),
    classes: listJson(r.classes, unitJson),
    folders_by_files: listJson(r.foldersByFiles, folderJson),
    folders_by_lines: listJson(r.foldersByLines, folderJson),
    tree: listJson(r.tree, treeJson),
  };
}

function listJson<T, J>(list: Ranked<T>, item: (t: T) => J) {
  return {
    truncated: { total: list.total, shown: list.items.length },
    items: list.items.map(item),
  };
}

function totalsJson(t: ScanTotals) {
  return {
    tracked: t.tracked,
    measured: t.measured,
    exempt: t.exempt,
    skipped: t.skipped,
    missing: t.missing,
    lines: t.lines,
    exempt_by: t.exemptBy,
    skipped_by: t.skippedBy,
    analysed: t.analysed,
    not_analysed: t.notAnalysedBy,
    units: t.units,
    over: t.over,
  };
}

const fileJson = (f: FileFinding) => ({
  kind: f.kind,
  path: f.path,
  unit: f.unit,
  measure: "lines",
  lines: f.lines,
  limit: f.limit,
  source: f.source,
  level: f.level,
  estimated: false,
});

/** `kind` is the unit. `name` is null unless an identifier of at most 80 characters (FR-014). */
const unitJson = (u: UnitFinding) => ({
  kind: u.kind,
  path: u.path,
  name: identifierOrNull(u.name),
  start_line: u.startLine,
  measure: "lines",
  lines: u.lines,
  limit: u.limit,
  source: u.source,
  level: u.level,
  estimated: true,
});

const folderJson = (f: FolderMeasure) => ({
  kind: f.kind,
  path: f.path,
  files: f.files,
  lines: f.lines,
});

const treeJson = (n: TreeNode) => ({
  path: n.path,
  depth: n.depth,
  files: n.files,
  lines: n.lines,
});

/** A hot spot points at an entry of its own list, which carries the limit and its source. */
function hotSpotJson(h: HotSpot) {
  if (h.kind === "folder") return folderJson(h);
  const at = { kind: h.kind, path: h.path, lines: h.lines, level: h.level };
  if (h.kind === "file") return at;
  return { ...at, name: identifierOrNull(h.name), start_line: h.startLine, estimated: true };
}

/**
 * The folder tree as a Mermaid flowchart. Node ids are generated (`n0`, `n1`…), so no path ever
 * becomes an id, and every label goes through `mermaidLabel`. The two statements are nodes of
 * their own, because a renderer drops comments.
 */
function scanMermaid(r: ScanReport): string {
  const lines = ["flowchart TD", `  s0["${mermaidLabel(r.statements.map)}"]`];
  lines.push(`  s1["${mermaidLabel(r.statements.data)}"]`);
  const ids = new Map<string, string>();
  for (const node of r.tree.items) {
    const id = `n${ids.size}`;
    ids.set(node.path, id);
    const label = `${node.path} (${node.files} files, ${node.lines} lines)`;
    lines.push(`  ${id}["${mermaidLabel(label)}"]`);
    const parent = node.depth === 0
      ? undefined
      : ids.get(node.depth === 1 ? "." : folderOf(node.path));
    if (parent !== undefined) lines.push(`  ${parent} --> ${id}`);
  }
  if (r.tree.total > r.tree.items.length) {
    lines.push(`  %% ${r.tree.items.length} of ${r.tree.total} folders shown (--top)`);
  }
  return lines.join("\n");
}
