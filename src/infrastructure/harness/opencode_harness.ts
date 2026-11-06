import { managedSectionField, ownershipFields } from "./harness_managed.ts";
import type { Harness } from "../../application/ports.ts";
import type { BundleOptions } from "../../application/bundle_options.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";
import { applyHarnessStatic } from "./harness_static.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { ensureSkillFrontmatter, skillDocDestination, skillFolderName } from "./skill_folder.ts";
import { frontmatterField, splitFrontmatter } from "./frontmatter.ts";
import { applyBackend, applyHarness, backlogScriptDestination } from "./backlog_filter.ts";
import { applyScheme, phaseScriptDestination } from "./scheme_filter.ts";
import { applySpecBackend } from "./spec_backend_filter.ts";
import { applySpecAutogen } from "./spec_autogen_filter.ts";
import { addUnique } from "./bundle_writer.ts";
import { SKILL_SURFACE } from "./skill_layout.ts";
import { AGENT_FOLDERS, agentFile } from "../../domain/agent_folders.ts";
import { CAPABILITIES, grantedCapabilities } from "../../domain/tool_grant.ts";

type PermissionValue = "allow" | "ask" | "deny" | { "*": "ask" | "allow" | "deny" };
type PermissionMap = Record<string, PermissionValue>;

/** How OpenCode allows each capability a seat is granted. */
const ALLOWED: Readonly<Record<string, PermissionValue>> = {
  read: "allow",
  write: "allow",
  edit: "allow",
  bash: { "*": "ask" },
  webfetch: "ask",
  websearch: "ask",
};

/**
 * The permission block for a seat's grant (`src/domain/tool_grant.ts`). Every
 * capability it does not grant is denied by name, `read` aside: silence would
 * leave OpenCode's own default in force, which is not the seat's grant.
 */
function translateToolsToPermissions(toolsField: string | null): PermissionMap | null {
  const granted = grantedCapabilities(toolsField);
  if (granted === null) return null;
  const map: PermissionMap = {};
  for (const capability of CAPABILITIES) {
    if (granted.has(capability)) map[capability] = ALLOWED[capability];
    else if (capability !== "read") map[capability] = "deny";
  }
  return map;
}

function stringifyPermissions(perms: PermissionMap): string {
  const lines: string[] = ["permission:"];
  for (const [key, value] of Object.entries(perms)) {
    if (typeof value === "string") {
      lines.push(`  ${key}: ${value}`);
    } else {
      // bash: { "*": "ask" } → block form
      lines.push(`  ${key}:`);
      for (const [pat, v] of Object.entries(value)) {
        lines.push(`    "${pat}": ${v}`);
      }
    }
  }
  return lines.join("\n");
}

function toOpenCodeAgentMarkdown(entry: CoreEntry): string {
  const split = splitFrontmatter(entry.content);
  const body = split ? split.rest.replace(/^\n+/, "") : entry.content;
  const description = split ? frontmatterField(split.fmBody, "description") : null;
  const tools = split ? frontmatterField(split.fmBody, "tools") : null;
  const perms = translateToolsToPermissions(tools);
  const lines: string[] = [];
  lines.push(description !== null ? `description: ${description}` : `description: ${entry.name}`);
  lines.push("mode: subagent");
  if (perms !== null) lines.push(stringifyPermissions(perms));
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "agent":
      return agentFile(AGENT_FOLDERS.opencode, entry.name);
    case "skill":
    case "backlog-skill":
      return `.opencode/skills/${skillFolderName(entry)}/SKILL.md`;
    case "backlog-doc":
    case "phase":
      // One shape: a document beside its skill, in that skill's own folder.
      return skillDocDestination(entry, SKILL_SURFACE.opencode.layout);
    case "phase-script":
      return phaseScriptDestination(entry);
    case "backlog-script":
      return backlogScriptDestination(entry);
    case "agent-memory":
      throw new Error("agent-memory entries should be filtered before destinationFor");
    case "agent-doc":
      throw new Error("agent-doc entries should be filtered before destinationFor");
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root needs suffix`);
      return `.specnaut/${entry.suffix}`;
    case "project-root":
    case "mergeable-project-root":
      if (!entry.suffix) throw new Error(`${entry.category} needs suffix`);
      return entry.suffix;
  }
}

export class OpenCodeHarness implements Harness {
  readonly key = "opencode";
  readonly displayName = "OpenCode";
  readonly managedRoots = [`${AGENT_FOLDERS.opencode.dir}/`, ".opencode/skills/"] as const;

  mapBundle(core: CoreBundle, opts: BundleOptions): Bundle {
    const out: Bundle = {};
    for (const raw of core) {
      const backendApplied = applyBackend(applyHarness(raw, this.key), opts);
      if (backendApplied === null) continue;
      const entry = applySpecAutogen(
        applySpecBackend(applyScheme(backendApplied, opts), opts),
        opts,
      );
      // agent-memory and the agent-fleet README are Claude-only conventions;
      // other harnesses skip them.
      if (entry.category === "agent-memory" || entry.category === "agent-doc") continue;
      const dest = destinationFor(entry);
      let content: string;
      switch (entry.category) {
        case "agent":
          content = toOpenCodeAgentMarkdown(entry);
          break;
        case "skill":
        case "backlog-skill":
          content = ensureSkillFrontmatter(entry.content, entry.name);
          break;
        default:
          content = entry.content;
      }
      addUnique(out, dest, {
        content,
        executable: entry.executable,
        ...(entry.category === "mergeable-project-root" ? { mergeBlock: "gitignore" } : {}),
        ...ownershipFields(entry),
        ...managedSectionField(entry),
      }, this.key);
    }
    // Layer the harness's own static files last, so a harness-specific file
    // wins over anything the core bundle mapped to the same destination.
    applyHarnessStatic(out, HARNESS_STATIC[this.key] ?? {}, opts);
    return out;
  }
}
