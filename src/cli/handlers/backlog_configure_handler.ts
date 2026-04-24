import { resolve } from "@std/path";
import { bold, green, red } from "@std/fmt/colors";
import { ConfigureSyncUseCase } from "../../application/configure_sync.ts";
import { FsConfigStore } from "../../infrastructure/fs_config_store.ts";
import { DenoSubprocessRunner } from "../../infrastructure/deno_subprocess.ts";
import { TerminalPrompt } from "../../infrastructure/terminal_prompt.ts";

export type BacklogConfigureIntent = { kind: "backlog-configure" };

async function detectRepo(): Promise<string> {
  const p = new Deno.Command("git", {
    args: ["remote", "get-url", "origin"],
    stdout: "piped",
    stderr: "null",
  });
  const out = await p.output();
  if (!out.success) throw new Error("git remote origin not set");
  const url = new TextDecoder().decode(out.stdout).trim();
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(\.git)?$/);
  if (!m) throw new Error(`Unsupported remote URL: ${url}`);
  return `${m[1]}/${m[2]}`;
}

export async function runBacklogConfigure(
  _intent: BacklogConfigureIntent,
): Promise<number> {
  const projectDir = resolve(Deno.cwd());
  let repoHint: string;
  try {
    repoHint = await detectRepo();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(red(`error: ${msg}`));
    return 1;
  }

  const uc = new ConfigureSyncUseCase({
    store: new FsConfigStore(),
    prompt: new TerminalPrompt(),
    runner: new DenoSubprocessRunner(),
  });

  try {
    const cfg = await uc.execute({ projectDir, repoHint });
    const store = new FsConfigStore();
    console.log(green(`✓ wrote ${store.configPath(projectDir)}`));
    console.log(`${bold("repo:")}    ${cfg.sync.repo}`);
    console.log(
      `${bold("project:")} ${cfg.sync.project ? `#${cfg.sync.project.number}` : "(none)"}`,
    );
    console.log("\nNext: `specflow backlog sync` to push your current backlog.");
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(red(`error: ${msg}`));
    return 1;
  }
}
