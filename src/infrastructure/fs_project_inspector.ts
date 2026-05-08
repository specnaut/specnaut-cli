import { join } from "@std/path";
import type { ProjectInspector } from "../application/ports.ts";
import type { CheckOutcome } from "../domain/check_result.ts";
import { type KnownHarness, parseLock } from "../domain/installed_lock.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

function isEmptyPlaceholderConstitution(text: string): boolean {
  return text.includes("(none defined yet)") || text.trim().length === 0;
}

/**
 * Validates the shape of `.claude/settings.json`'s `hooks` field.
 *
 * Catches the common "matcher as array" mistake — Claude Code expects
 * a string with `|` for OR, not a JS array. Other structural checks ensure
 * each hook entry has the right shape so they don't silently fail at runtime.
 */
function validateHooks(hooks: unknown): string[] {
  const errors: string[] = [];
  if (typeof hooks !== "object" || hooks === null) {
    return ["hooks must be an object"];
  }
  for (const [event, entries] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(entries)) {
      errors.push(`hooks.${event} must be an array`);
      continue;
    }
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (typeof entry !== "object" || entry === null) {
        errors.push(`hooks.${event}[${i}] must be an object`);
        continue;
      }
      const e = entry as Record<string, unknown>;
      if (e.matcher !== undefined && typeof e.matcher !== "string") {
        errors.push(
          `hooks.${event}[${i}].matcher must be a string (got ${typeof e
            .matcher} — common mistake; use "Edit|Write" not ["Edit","Write"])`,
        );
      }
      if (!Array.isArray(e.hooks)) {
        errors.push(`hooks.${event}[${i}].hooks must be an array`);
      }
    }
  }
  return errors;
}

export class FsProjectInspector implements ProjectInspector {
  async inspect(projectDir: string, templatesVersion: string): Promise<CheckOutcome[]> {
    const outcomes: CheckOutcome[] = [];

    outcomes.push(await this.checkDir(projectDir, ".specflow/"));
    outcomes.push(await this.checkHarness(projectDir));
    outcomes.push(await this.checkConstitution(projectDir));
    outcomes.push(await this.checkTemplatesVersion(projectDir, templatesVersion));
    outcomes.push(...await this.checkClaudeConfig(projectDir));

    return outcomes;
  }

  /**
   * Validates Claude Code-specific config files when the project's harness
   * is Claude. Catches the most common footguns documented at
   * https://code.claude.com/docs/fr/hooks-guide and /docs/fr/mcp.
   *
   * Returns an empty list for non-Claude harnesses or when no relevant
   * config files exist.
   */
  private async checkClaudeConfig(projectDir: string): Promise<CheckOutcome[]> {
    const lockPath = join(projectDir, ".specflow/installed.lock");
    if (!(await exists(lockPath))) return [];
    let lock;
    try {
      lock = parseLock(await Deno.readTextFile(lockPath));
    } catch {
      return [];
    }
    if (lock.harness !== "claude") return [];

    const outcomes: CheckOutcome[] = [];
    outcomes.push(...await this.checkSettingsJson(projectDir, ".claude/settings.json"));
    outcomes.push(...await this.checkSettingsJson(projectDir, ".claude/settings.local.json"));
    outcomes.push(...await this.checkMcpJson(projectDir));
    return outcomes;
  }

  private async checkSettingsJson(
    projectDir: string,
    rel: string,
  ): Promise<CheckOutcome[]> {
    const path = join(projectDir, rel);
    if (!(await exists(path))) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(await Deno.readTextFile(path));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return [{ name: rel, status: "fail", message: `invalid JSON — ${msg}` }];
    }

    if (typeof parsed !== "object" || parsed === null) {
      return [{ name: rel, status: "fail", message: "must be a JSON object" }];
    }

    const root = parsed as Record<string, unknown>;
    if (root.hooks === undefined) {
      return [{ name: rel, status: "pass", message: "well-formed (no hooks)" }];
    }
    const errors = validateHooks(root.hooks);
    if (errors.length > 0) {
      return [{ name: `${rel} hooks`, status: "fail", message: errors.join("; ") }];
    }
    return [{ name: `${rel} hooks`, status: "pass", message: "well-formed" }];
  }

  private async checkMcpJson(projectDir: string): Promise<CheckOutcome[]> {
    const path = join(projectDir, ".mcp.json");
    if (!(await exists(path))) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(await Deno.readTextFile(path));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return [{ name: ".mcp.json", status: "fail", message: `invalid JSON — ${msg}` }];
    }

    if (typeof parsed !== "object" || parsed === null) {
      return [{ name: ".mcp.json", status: "fail", message: "must be a JSON object" }];
    }

    const errors: string[] = [];
    const servers = (parsed as Record<string, unknown>).mcpServers;
    if (typeof servers === "object" && servers !== null) {
      for (const [name, server] of Object.entries(servers)) {
        if (typeof server !== "object" || server === null) continue;
        const cmd = (server as Record<string, unknown>).command;
        if (typeof cmd === "string" && (cmd.startsWith("./") || cmd.startsWith("../"))) {
          errors.push(
            `mcpServers.${name}.command uses relative path '${cmd}' — use absolute paths or 'npx'/'uvx' (relative paths resolve from the directory where Claude Code was launched, not the .mcp.json location)`,
          );
        }
      }
    }
    if (errors.length > 0) {
      return [{ name: ".mcp.json", status: "warn", message: errors.join("; ") }];
    }
    return [{ name: ".mcp.json", status: "pass", message: "well-formed" }];
  }

  private async checkHarness(projectDir: string): Promise<CheckOutcome> {
    const path = join(projectDir, ".specflow/installed.lock");
    if (!(await exists(path))) {
      return {
        name: "harness",
        status: "warn",
        message: "no installed.lock (pre-upgrade-tracking project)",
      };
    }
    try {
      const raw = await Deno.readTextFile(path);
      const lock = parseLock(raw);
      const expectedFolder: Record<KnownHarness, string> = {
        claude: ".claude/",
        cursor: ".cursor/",
        codex: ".agents/",
        gemini: ".gemini/",
        windsurf: ".windsurf/",
        copilot: ".github/instructions/",
        opencode: ".opencode/",
      };
      const folder = expectedFolder[lock.harness];
      const folderPresent = await exists(join(projectDir, folder));
      if (!folderPresent) {
        return {
          name: "harness",
          status: "fail",
          message: `lock says ${lock.harness} but ${folder} is missing`,
        };
      }
      return {
        name: "harness",
        status: "pass",
        message: `${lock.harness} — ${folder} present`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { name: "harness", status: "fail", message: `corrupt lock — ${msg}` };
    }
  }

  private async checkTemplatesVersion(
    projectDir: string,
    bundledTemplatesVersion: string,
  ): Promise<CheckOutcome> {
    const path = join(projectDir, ".specflow/installed.lock");
    if (!(await exists(path))) {
      return {
        name: "templates version",
        status: "warn",
        message:
          "no .specflow/installed.lock — re-init with 'specflow init --here --force' to enable upgrade tracking",
      };
    }
    try {
      const raw = await Deno.readTextFile(path);
      const lock = parseLock(raw);
      if (lock.templatesVersion === bundledTemplatesVersion) {
        return {
          name: "templates version",
          status: "pass",
          message: `lock matches bundled (${bundledTemplatesVersion})`,
        };
      }
      return {
        name: "templates version",
        status: "warn",
        message:
          `project on ${lock.templatesVersion}, bundled on ${bundledTemplatesVersion} — run 'specflow upgrade'`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { name: "templates version", status: "fail", message: `corrupt lock — ${msg}` };
    }
  }

  private async checkDir(projectDir: string, rel: string): Promise<CheckOutcome> {
    const path = join(projectDir, rel);
    return (await exists(path))
      ? { name: rel, status: "pass", message: "present" }
      : { name: rel, status: "fail", message: `missing — run 'specflow init --here'` };
  }

  private async checkConstitution(projectDir: string): Promise<CheckOutcome> {
    const path = join(projectDir, ".specflow/memory/constitution.md");
    if (!(await exists(path))) {
      return {
        name: "constitution",
        status: "fail",
        message: "missing .specflow/memory/constitution.md",
      };
    }
    const text = await Deno.readTextFile(path);
    if (isEmptyPlaceholderConstitution(text)) {
      return {
        name: "constitution",
        status: "warn",
        message: "placeholder — edit .specflow/memory/constitution.md",
      };
    }
    return { name: "constitution", status: "pass", message: "populated" };
  }
}
