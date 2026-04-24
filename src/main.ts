import { red } from "@std/fmt/colors";
import { HELP, renderVersionLine } from "./cli/help.ts";
import { parseArgs } from "./cli/parser.ts";
import { TEMPLATES_VERSION, VERSION } from "./domain/version.ts";

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
    case "unknown":
      console.error(red(`Unknown command: "${intent.received}"`));
      console.error(HELP);
      return 2;
  }
}

if (import.meta.main) {
  Deno.exit(await run(Deno.args));
}
