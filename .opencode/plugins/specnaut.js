/**
 * Specnaut plugin for OpenCode.
 *
 * It does one thing: add Specnaut's skills directory to OpenCode's skill
 * search path, so `"plugin": ["specnaut@git+…"]` in `opencode.json` is enough
 * to make the skills available.
 *
 * It deliberately does nothing else. It reads no file, injects nothing into a
 * prompt or a message, and takes no path from the session — the directory
 * comes from this module's own location, never from the project that is open,
 * the working directory or the environment. A plugin that loads instructions
 * into an agent must not let the opened repository choose them.
 */

import path from "path";
import { fileURLToPath } from "url";

const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../plugin/skills");

export const SpecnautPlugin = async () => ({
  config: async (config) => {
    config.skills = config.skills || {};
    config.skills.paths = config.skills.paths || [];
    if (!config.skills.paths.includes(SKILLS_DIR)) config.skills.paths.push(SKILLS_DIR);
  },
});
