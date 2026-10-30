import { red } from "@std/fmt/colors";
import { type HarnessKey, pickHarness, pickHarnessInteractive } from "../harness_picker.ts";
import { pickBacklogBackend, pickBacklogBackendInteractive } from "../backlog_picker.ts";
import { pickVersionScheme, pickVersionSchemeInteractive } from "../scheme_picker.ts";
import { pickSpecBackend, pickSpecBackendInteractive } from "../spec_picker.ts";
import { makeStdinSelectIO } from "../select.ts";
import type { BacklogBackend, SpecBackend, VersionScheme } from "../../domain/installed_lock.ts";
import { SPEC_STRATEGIES } from "../../domain/spec_strategies/registry.ts";
import { detectVersionScheme } from "../../domain/project_detection.ts";
import { BACKLOG_STRATEGIES } from "../../domain/backlog_strategies/registry.ts";

/**
 * The choices `specnaut init` asks for when no flag gave them: harness, backlog
 * backend, version scheme and spec backend. Each takes the explicit flag first,
 * then the interactive picker on a TTY, then a numeric prompt — so `init` reads
 * as the steps it runs rather than the four ways it can ask a question.
 */

/** The user closed an interactive picker: stop the whole init, as Ctrl-C would (exit 130). */
function orAbort<T>(picked: T | null): T {
  if (picked === null) {
    console.error(red("aborted."));
    Deno.exit(130);
  }
  return picked;
}

export async function resolveHarnessKey(
  explicit: HarnessKey | null,
): Promise<HarnessKey> {
  if (explicit !== null) return explicit;
  if (!Deno.stdin.isTerminal()) {
    return pickHarness({
      readLine: () => prompt("Choose [1-8]:"),
      log: (s) => console.log(s),
      errLog: (s) => console.error(red(s)),
    });
  }
  const picked = await pickHarnessInteractive(makeStdinSelectIO());
  return orAbort(picked);
}

export async function resolveBacklogBackend(
  explicit: BacklogBackend | null,
): Promise<BacklogBackend> {
  if (explicit !== null) return explicit;
  if (!Deno.stdin.isTerminal()) {
    return pickBacklogBackend({
      readLine: () => prompt(`Choose [1-${BACKLOG_STRATEGIES.length}]:`),
      log: (s) => console.log(s),
      errLog: (s) => console.error(red(s)),
    });
  }
  const picked = await pickBacklogBackendInteractive(makeStdinSelectIO());
  return orAbort(picked);
}

/**
 * Resolves the spec backend: explicit `--spec-backend` flag wins; otherwise the
 * interactive picker (TTY) or the non-TTY numeric prompt fall back to the
 * recommended default (spec 020, FR-001). Mirrors {@link resolveBacklogBackend}.
 */
export async function resolveSpecBackend(
  explicit: SpecBackend | null,
): Promise<SpecBackend> {
  if (explicit !== null) return explicit;
  if (!Deno.stdin.isTerminal()) {
    return pickSpecBackend({
      readLine: () => prompt(`Choose [1-${SPEC_STRATEGIES.length}]:`),
      log: (s) => console.log(s),
      errLog: (s) => console.error(red(s)),
    });
  }
  const picked = await pickSpecBackendInteractive(makeStdinSelectIO());
  return orAbort(picked);
}

/**
 * Detects whether the user's project looks like a library by probing
 * common manifest files at `targetDir`. The result is a soft suggestion
 * pre-positioning the picker cursor — the user always has the final
 * say via the prompt.
 */
export function detectSchemeSuggestion(targetDir: string): VersionScheme {
  const result = detectVersionScheme({
    exists(rel) {
      try {
        Deno.statSync(`${targetDir}/${rel}`);
        return true;
      } catch {
        return false;
      }
    },
    readText(rel) {
      try {
        return Deno.readTextFileSync(`${targetDir}/${rel}`);
      } catch {
        return null;
      }
    },
    listTags() {
      // `git tag -l` is the cheapest read: a few KB of stdout for the
      // largest repos, no network. If anything fails (no git binary, no
      // .git dir, command errors), return an empty list — the detector
      // treats absence as "no signal", not a failure.
      try {
        const out = new Deno.Command("git", {
          args: ["tag", "-l"],
          cwd: targetDir,
          stdout: "piped",
          stderr: "null",
        }).outputSync();
        if (!out.success) return [];
        return new TextDecoder()
          .decode(out.stdout)
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      } catch {
        return [];
      }
    },
  });
  return result.suggestedScheme;
}

export async function resolveVersionScheme(
  explicit: VersionScheme | null,
  suggestion: VersionScheme,
): Promise<VersionScheme> {
  if (explicit !== null) return explicit;
  if (!Deno.stdin.isTerminal()) {
    return pickVersionScheme(
      {
        readLine: () => prompt("Choose [1-2]:"),
        log: (s) => console.log(s),
        errLog: (s) => console.error(red(s)),
      },
      suggestion,
    );
  }
  const picked = await pickVersionSchemeInteractive(
    makeStdinSelectIO(),
    suggestion,
  );
  return orAbort(picked);
}
