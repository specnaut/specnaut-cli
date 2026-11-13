import { red, yellow } from "@std/fmt/colors";
import { HELP, renderVersionLine } from "./cli/help.ts";
import { parseArgs } from "./cli/parser.ts";
import { isLegacyInvocation, LEGACY_INVOCATION_WARNING } from "./domain/deprecation.ts";
import { RemovedHarnessError, removedHarnessInitNotice } from "./domain/installed_lock.ts";
import { VERSION } from "./domain/version.ts";
import { TEMPLATES_VERSION } from "./templates_bundle.ts";
import { errorText, uncaughtText } from "./domain/terminal_text.ts";

/**
 * Runs one command. Nothing it throws reaches Deno's own handler, which prints a message raw
 * (cli#785): every error leaves through the escaping the lock messages use, and the run exits 1.
 */
export async function run(
  argv: string[],
  command: (argv: string[]) => Promise<number> = dispatch,
): Promise<number> {
  try {
    return await command(argv);
  } catch (err) {
    // A project installed for a harness Specnaut has since dropped. Every
    // command that loads the lock lands here, so the message is said once
    // and never reaches the user as a stack trace.
    const said = err instanceof RemovedHarnessError ? errorText(err) : uncaughtText(err);
    console.error(red(`error: ${said}`));
    return 1;
  }
}

/**
 * The same sink for what escapes `run` without passing through it: a rejection nothing awaits, a
 * throw from a timer. Deno would print either raw and exit 1; this prints it escaped, then exits 1.
 */
export function installUncaughtSinks(): void {
  // Exiting from the listener is what keeps Deno's handler from printing it after.
  const sink = (err: unknown) => {
    console.error(red(`error: ${uncaughtText(err)}`));
    Deno.exit(1);
  };
  addEventListener("unhandledrejection", (e) => sink(e.reason));
  addEventListener("error", (e) => sink(e.error));
}

/** A handler module is evaluated only when its command runs: `--version` evaluates none. */
async function dispatch(argv: string[]): Promise<number> {
  const intent = parseArgs(argv);
  switch (intent.kind) {
    case "version":
      console.log(renderVersionLine(VERSION, TEMPLATES_VERSION));
      return 0;
    case "help":
      console.log(HELP);
      return 0;
    case "init":
      return (await import("./cli/handlers/init_handler.ts")).runInit(intent);
    case "self-update":
      return (await import("./cli/handlers/self_update_handler.ts")).handleSelfUpdate(intent);
    case "check":
      return (await import("./cli/handlers/check_handler.ts")).runCheck(intent);
    case "upgrade":
      return (await import("./cli/handlers/upgrade_handler.ts")).runUpgrade(intent);
    case "diff":
      return (await import("./cli/handlers/diff_handler.ts")).runDiff(intent);
    case "scan":
      return (await import("./cli/handlers/scan_handler.ts")).runScan(intent);
    case "sandbox":
      return (await import("./cli/handlers/sandbox_handler.ts")).runSandbox(intent);
    case "verify-scripts":
      return (await import("./cli/handlers/verify_scripts_handler.ts")).runVerifyScripts();
    case "review":
      return (await import("./cli/handlers/review_handler.ts")).runReview(intent);
    case "record-checkout":
      return (await import("./cli/handlers/record_checkout_handler.ts")).runRecordCheckout();
    case "reconcile-status":
    case "reconcile-path":
      return (await import("./cli/handlers/reconcile_handler.ts")).runReconcile(intent);
    case "cloud":
      return (await import("./cli/handlers/cloud_handler.ts")).runCloud(intent);
    case "gate":
      return (await import("./cli/handlers/gate_handler.ts")).runGate(intent);
    case "spec":
      return (await import("./cli/handlers/spec_handler.ts")).runSpec(intent);
    case "removed-harness":
      console.error(red(`error: ${removedHarnessInitNotice(intent.harness)}`));
      return 1;
    case "unknown":
      console.error(red(`Unknown command: "${intent.received}"`));
      console.error(HELP);
      return 2;
  }
}

if (import.meta.main) {
  installUncaughtSinks();
  // Deprecated-alias notice: warn (don't block) when invoked as `specflow`.
  if (isLegacyInvocation(Deno.execPath())) {
    console.error(yellow(LEGACY_INVOCATION_WARNING));
  }
  Deno.exit(await run(Deno.args));
}
