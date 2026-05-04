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

export class FsProjectInspector implements ProjectInspector {
  async inspect(projectDir: string, templatesVersion: string): Promise<CheckOutcome[]> {
    const outcomes: CheckOutcome[] = [];

    outcomes.push(await this.checkDir(projectDir, ".specflow/"));
    outcomes.push(await this.checkHarness(projectDir));
    outcomes.push(await this.checkConstitution(projectDir));
    outcomes.push(await this.checkTemplatesVersion(projectDir, templatesVersion));

    return outcomes;
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
