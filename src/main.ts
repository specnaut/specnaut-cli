import { bold, cyan, red } from "@std/fmt/colors";
import { parseArgs } from "./cli/parser.ts";
import { TEMPLATES_VERSION, VERSION } from "./domain/version.ts";

const HELP = `${bold("specflow")} — improved spec-kit CLI with auto-chain, review, and backlog

${bold("Usage:")}
  specflow init <project-name>        Bootstrap a new project in ./<project-name>
  specflow init --here                Bootstrap in the current directory
  specflow --version                  Print version
  specflow --help                     Show this help

${bold("Flags (for init):")}
  --here         Scaffold into the current directory instead of creating a new one
  --no-git       Skip "git init" detection and prompt
  --ai <name>    Target AI harness (v0.1: claude only)

${bold("Docs:")}  ${cyan("https://github.com/kevinraimbaud/specflow")}`;

export async function run(argv: string[]): Promise<number> {
  const intent = parseArgs(argv);
  switch (intent.kind) {
    case "version":
      console.log(`specflow ${VERSION} (templates ${TEMPLATES_VERSION})`);
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
