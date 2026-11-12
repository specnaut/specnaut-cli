import {
  isRemovedHarness,
  KNOWN_BACKLOG_BACKENDS,
  KNOWN_SPEC_BACKENDS,
  KNOWN_VERSION_SCHEMES,
} from "../domain/installed_lock.ts";
import type { Intent } from "./intent.ts";
import { validateKnownArg } from "./known_value.ts";

/** `specnaut init`'s arguments, validated into its intent; an unknown value is `unknown`. */
export function parseInit(
  parsed: Readonly<Record<string, unknown>>,
  rest: readonly string[],
): Intent {
  const aiProvided = typeof parsed.ai === "string";
  const aiRaw = aiProvided ? (parsed.ai as string) : null;
  if (aiRaw !== null && isRemovedHarness(aiRaw)) {
    return { kind: "removed-harness", harness: aiRaw };
  }
  if (
    aiRaw !== null &&
    aiRaw !== "claude" &&
    aiRaw !== "cursor" &&
    aiRaw !== "codex" &&
    aiRaw !== "copilot" &&
    aiRaw !== "opencode" &&
    aiRaw !== "antigravity"
  ) {
    return { kind: "unknown", received: `init --ai ${aiRaw}` };
  }
  const backlogProvided = typeof parsed.backlog === "string";
  const backlogRaw = backlogProvided ? (parsed.backlog as string) : null;
  const backlogResult = validateKnownArg(backlogRaw, KNOWN_BACKLOG_BACKENDS);
  if (!backlogResult.ok) {
    return { kind: "unknown", received: `init --backlog ${backlogRaw}` };
  }
  const backlogUrlRaw = typeof parsed["backlog-url"] === "string"
    ? (parsed["backlog-url"] as string)
    : null;
  const backlogRepoRaw = typeof parsed["backlog-repo"] === "string"
    ? (parsed["backlog-repo"] as string)
    : null;
  const schemeProvided = typeof parsed.scheme === "string";
  const schemeRaw = schemeProvided ? (parsed.scheme as string) : null;
  const schemeResult = validateKnownArg(schemeRaw, KNOWN_VERSION_SCHEMES);
  if (!schemeResult.ok) {
    return { kind: "unknown", received: `init --scheme ${schemeRaw}` };
  }
  const specBackendRaw = typeof parsed["spec-backend"] === "string"
    ? (parsed["spec-backend"] as string)
    : null;
  const specBackendResult = validateKnownArg(specBackendRaw, KNOWN_SPEC_BACKENDS);
  if (!specBackendResult.ok) {
    return { kind: "unknown", received: `init --spec-backend ${specBackendRaw}` };
  }
  return {
    kind: "init",
    projectName: rest[0] ?? null,
    here: Boolean(parsed.here),
    noGit: Boolean(parsed["no-git"]),
    ai: aiRaw,
    backlog: backlogResult.value,
    backlogUrl: backlogUrlRaw,
    backlogRepo: backlogRepoRaw,
    scheme: schemeResult.value,
    specBackend: specBackendResult.value,
    force: Boolean(parsed.force),
    dryRun: Boolean(parsed["dry-run"]),
    resetPreserved: Boolean(parsed["reset-preserved"]),
  };
}
