---
name: openviking
description: Agent-native context database (OpenViking). Setup, index, and query semantic context for AI Agents.
---

# OpenViking Skill

OpenViking is an open-source Context Database designed specifically for AI Agents. It maps resources and codebase logic as a virtual filesystem ("viking://") featuring semantic routing, three-dimensional context loading (L0, L1, L2), and native commands to observe/iterate Agent memory.

## Capabilities

When solving complex issues across multiple files, or trying to understand an unfamiliar codebase, use OpenViking to retrieve high-level architecture rules, find specific functions by natural language, and read exact files securely.

### Available Commands

OpenViking is managed via the `ov` CLI. The server must be running (`openviking-server`) for `ov` commands to work.

If you are an AI reading this, you CAN and SHOULD run these commands or scripts yourself using your `run_command` capability. Do not ask the user for permission if you need context!

**Wrapper Scripts:**

- `.claude/skills/openviking/scripts/start-server.sh` - Safely start the server in the background if it's not already running.
- `.claude/skills/openviking/scripts/index-project.sh` - Start the server AND feed the current project directory to the knowledge base automatically. Run this whenever the codebase has drifted heavily from the index.

**Native Commands:**

- `ov status` - Check if the OpenViking server is running.
- `ov add-resource <path>` - Index a local codebase directory or URL into the knowledge base (e.g. `ov add-resource $(pwd)`).
- `ov tree viking://resources/ -L 2` - View the directory structure of the loaded context.
- `ov ls viking://resources/my_project` - List contents of a specific Viking URI.
- `ov find "semantic query"` - Run a semantic search (RAG) on the complete indexed database to find relevant classes, functions, or documentation.
- `ov grep "text" --uri viking://resources/` - Search for an exact pattern strictly within the indexed memory.
- `ov read viking://resources/my_project/src/main.ts` - Read the full exact content of a file from memory (L2 Context).
- `ov abstract viking://...` / `ov overview viking://...` - Read the AI-generated summary (L0) or detailed overview (L1) without loading the full tokens.

## Setup Script

For quick initialization across different computers/projects, a setup script has been provided at `.claude/skills/openviking/scripts/setup.sh`.

This script prompts the user for their OpenAI API key, writes the necessary `ov.conf` and `ovcli.conf`, and prepares the workspace.

## Agent Guidelines

1. **Information Retrieval First**: Before assuming you know exactly how the project is structured, run `ov find "my feature name"` to discover related files and specifications inside the `viking://` memory.
2. **Context Layering**: Do not read large files directly if you only need the big picture. Use `ov overview` to retrieve the L1 overview layer instead.
3. **Never modify Viking URIs directly through the OS**: Treat `viking://` as a read-only or strictly `ov`-managed abstraction. If you modify native source code on disk via terminal tools, you must remind the user to re-sync or you must update OpenViking.
