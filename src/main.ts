import { red, yellow } from "@std/fmt/colors";
import { HELP, renderVersionLine } from "./cli/help.ts";
import { parseArgs } from "./cli/parser.ts";
import { isLegacyInvocation, LEGACY_INVOCATION_WARNING } from "./domain/deprecation.ts";
import { RemovedHarnessError, removedHarnessInitNotice } from "./domain/installed_lock.ts";
import { VERSION } from "./domain/version.ts";
import { TEMPLATES_VERSION } from "./templates_bundle.ts";

export async function run(argv: string[]): Promise<number> {
  try {
    return await dispatch(argv);
  } catch (err) {
    // A project installed for a harness Specnaut has since dropped. Every
    // command that loads the lock lands here, so the message is said once
    // and never reaches the user as a stack trace.
    if (err instanceof RemovedHarnessError) {
      console.error(red(`error: ${err.message}`));
      return 1;
    }
    throw err;
  }
}

async function dispatch(argv: string[]): Promise<number> {
  const intent = parseArgs(argv);
  switch (intent.kind) {
    case "version":
      console.log(renderVersionLine(VERSION, TEMPLATES_VERSION));
      return 0;
    case "help":
      console.log(HELP);
      return 0;
    case "init": {
      const { runInit } = await import("./cli/handlers/init_handler.ts");
      return await runInit(intent);
    }
    case "self-update": {
      const { handleSelfUpdate } = await import(
        "./cli/handlers/self_update_handler.ts"
      );
      return await handleSelfUpdate(intent);
    }
    case "check": {
      const { runCheck } = await import("./cli/handlers/check_handler.ts");
      return await runCheck(intent);
    }
    case "upgrade": {
      const { runUpgrade } = await import("./cli/handlers/upgrade_handler.ts");
      return await runUpgrade(intent);
    }
    case "diff": {
      const { runDiff } = await import("./cli/handlers/diff_handler.ts");
      return await runDiff(intent);
    }
    case "reconcile-status":
    case "reconcile-path": {
      const { runReconcile } = await import("./cli/handlers/reconcile_handler.ts");
      return await runReconcile(intent);
    }
    case "cloud": {
      const { runCloud } = await import("./cli/handlers/cloud_handler.ts");
      return await runCloud(intent);
    }
    case "gate": {
      const { runGate } = await import("./cli/handlers/gate_handler.ts");
      return await runGate(intent);
    }
    case "spec": {
      const { runSpec } = await import("./cli/handlers/spec_handler.ts");
      return await runSpec(intent);
    }
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
  // Deprecated-alias notice: warn (don't block) when invoked as `specflow`.
  if (isLegacyInvocation(Deno.execPath())) {
    console.error(yellow(LEGACY_INVOCATION_WARNING));
  }
  Deno.exit(await run(Deno.args));
}
