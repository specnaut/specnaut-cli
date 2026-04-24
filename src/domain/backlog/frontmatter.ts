import { parse as parseYaml } from "@std/yaml";
import {
  assertValidComplexity,
  assertValidPriority,
  assertValidStatus,
  type BacklogTask,
} from "./task.ts";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  // YAML parsers may coerce date-like values (e.g. 2026-04-24) to Date objects.
  if (v instanceof Date) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Frontmatter missing required string '${key}'`);
  }
  return v;
}

function optionalStringArray(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error(`Frontmatter '${key}' must be an array`);
  return v.map((x) => String(x));
}

export function parseFrontmatter(raw: string): BacklogTask {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) {
    throw new Error("Missing YAML frontmatter (expected --- delimiters)");
  }
  const parsed = parseYaml(m[1]);
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("Frontmatter is empty or not a mapping");
  }
  const obj = parsed as Record<string, unknown>;

  const rawId = obj.id;
  if (rawId === undefined || rawId === null) {
    throw new Error("Frontmatter missing required 'id'");
  }
  const id = String(rawId).padStart(3, "0");

  const title = requireString(obj, "title");
  const category = requireString(obj, "category");

  const priority = requireString(obj, "priority");
  assertValidPriority(priority);

  const complexity = obj.complexity;
  assertValidComplexity(complexity);

  const status = requireString(obj, "status");
  assertValidStatus(status);

  const created = requireString(obj, "created");

  const dependsOn = optionalStringArray(obj, "depends_on");
  const tags = optionalStringArray(obj, "tags");

  const specRaw = obj.spec;
  const spec = specRaw === undefined || specRaw === null ? null : String(specRaw);

  const body = m[2] ?? "";

  return {
    id,
    title,
    category,
    priority,
    complexity,
    status,
    dependsOn,
    spec,
    tags,
    created,
    body,
  };
}
