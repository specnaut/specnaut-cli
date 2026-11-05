import { assert } from "@std/assert";
import { run } from "./git_sandbox.ts";

/**
 * Whether a file's PowerShell arm can run. It runs through `git_sandbox.ts`'s
 * hermetic `run`, as the arm itself does, which is also what stands for `exec`.
 */
async function hasPwsh(): Promise<boolean> {
  try {
    return (await run("pwsh", ["-NoProfile", "-Command", "exit 0"], ".")).code === 0;
  } catch (err) {
    console.warn(`  note: pwsh could not start (${err}) — the PowerShell arm did not run`);
    return false;
  }
}

export const PWSH_AVAILABLE = await hasPwsh();

/**
 * Registers the guard: GitHub-hosted runners ship pwsh on every OS, so on CI its
 * absence is a broken environment, not a reason to halve what the file covers.
 */
export function guardPowerShellArm(): void {
  Deno.test("the PowerShell arm runs where it must", () => {
    if (Deno.env.get("CI") === "true") assert(PWSH_AVAILABLE, "pwsh is absent on CI");
  });
}
