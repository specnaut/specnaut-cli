import { red } from "@std/fmt/colors";
import { HELP, renderVersionLine } from "./cli/help.ts";
import { parseArgs } from "./cli/parser.ts";
import { VERSION } from "./domain/version.ts";
import { TEMPLATES_VERSION } from "./templates_bundle.ts";

export async function run(argv: string[]): Promise<number> {
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
    case "reconcile-status":
    case "reconcile-path": {
      const { runReconcile } = await import("./cli/handlers/reconcile_handler.ts");
      return await runReconcile(intent);
    }
    case "cloud": {
      const { runCloud } = await import("./cli/handlers/cloud_handler.ts");
      return await runCloud(intent);
    }
    case "unknown":
      console.error(red(`Unknown command: "${intent.received}"`));
      console.error(HELP);
      return 2;
  }
}

if (import.meta.main) {
  Deno.exit(await run(Deno.args));
}
