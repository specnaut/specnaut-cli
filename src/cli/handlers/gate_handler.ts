// `specnaut gate <status|raise|cancel>` (#358) — the non-interactive bridge a skill phase uses
// to raise a remote-control gate and block for a human's answer. It wraps the agent-side gate
// session (#357); skill phases (clarify here, plan/merge approval in #359) shell out to it.
//
//   status   exit 0 + {"enabled":true,...} when remote mode is on for the project;
//            exit 2 when off, exit 5 when the project isn't Cloud-linked, exit 1 when
//            its api_url is unreadable or not a plain http(s) URL.
//   raise    open → await → apply a gate; prints the answer JSON on stdout and
//            exits 0 (answered) / 3 (unresolved) / 4 (cancelled) / 5 (no_remote)
//            / 1 (other). Distinct codes let the phase branch deterministically.
//   cancel   withdraw an open gate by id.
//
// Constitution § I: stdout carries only the public answer JSON; errors are
// CLI-owned messages + exit codes — never a Cloud-internal identifier or backend
// string.

import { red, yellow } from "@std/fmt/colors";
import { defaultCredentialStore } from "../../infrastructure/credential_store.ts";
import { FsBacklogConfigStore } from "../../infrastructure/fs_backlog_config_store.ts";
import { isLocalFailure } from "./cloud_local_failure.ts";
import { REDIRECT_REFUSED } from "../../domain/cloud/cloud_wire.ts";
import { terminalJson } from "../../domain/terminal_text.ts";
import type { GateErrorReason } from "../../domain/cloud/gate_client.ts";
import {
  GateSession,
  makeGateSession,
  type ResolutionOutcome,
} from "../../domain/cloud/gate_session.ts";
import type { GateRequest, GateType } from "../../domain/cloud/gate_contract.ts";
import { GATE_TYPES, isGateType } from "../../domain/cloud/gate_contract.ts";

export type GateIntent = {
  kind: "gate";
  sub: "status" | "raise" | "cancel";
  apiUrl: string | null;
  type: string | null;
  title: string | null;
  payload: string | null;
  task: number | null;
  id: string | null;
};

/** Injectable IO seam — defaults to real stdio/cwd/env; overridden in tests. */
export type GateDeps = {
  out: (s: string) => void;
  err: (s: string) => void;
  /** Build a session for the project, or null when not Cloud-linked. */
  buildSession: () => Promise<GateSession | null>;
};

/** Why a gate request failed, in a sentence (the reason itself is an internal branch key). */
const FAILURE: Record<GateErrorReason | "no_remote", string> = {
  transient: "Specnaut Cloud cannot be reached right now; retry.",
  unauthorized: "not authenticated with Specnaut Cloud; run `specnaut cloud login`.",
  not_found: "Specnaut Cloud does not know this gate.",
  conflict: "the gate is no longer in a state that allows this.",
  forbidden: "Specnaut Cloud refuses this account here; check its access to the project.",
  invalid: "Specnaut Cloud refused the request as invalid.",
  unexpected: "Specnaut Cloud answered unexpectedly; retry.",
  redirected: `${REDIRECT_REFUSED}.`,
  no_remote: "remote mode requires a Cloud login (`specnaut cloud login`).",
};

function defaultDeps(intent: GateIntent): GateDeps {
  return {
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    buildSession: async () => {
      const config = await new FsBacklogConfigStore().readCloudConfig(Deno.cwd());
      if (!config) return null;
      const apiUrl = intent.apiUrl ?? config.apiUrl;
      if (!apiUrl) return null;
      return makeGateSession({
        config: { ...config, apiUrl },
        store: defaultCredentialStore(),
        env: (k) => Deno.env.get(k),
        warn: (msg) => console.error(yellow(`warning: ${msg}`)),
      });
    },
  };
}

export async function runGate(
  intent: GateIntent,
  deps: GateDeps = defaultDeps(intent),
): Promise<number> {
  try {
    return await runGateUnguarded(intent, deps);
  } catch (e) {
    if (!isLocalFailure(e)) throw e;
    deps.err(red(`error: ${e.message}`));
    return 1;
  }
}

async function runGateUnguarded(intent: GateIntent, deps: GateDeps): Promise<number> {
  switch (intent.sub) {
    case "status":
      return await runStatus(deps);
    case "raise":
      return await runRaise(intent, deps);
    case "cancel":
      return await runCancel(intent, deps);
  }
}

async function runStatus(deps: GateDeps): Promise<number> {
  const session = await deps.buildSession();
  if (!session) {
    deps.err(red("error: project is not Cloud-linked (run `specnaut cloud login`)."));
    return 5;
  }
  if (!session.remote.enabled) {
    deps.err(yellow("remote mode is off (set `remote.enabled` or SPECNAUT_REMOTE=1)."));
    return 2;
  }
  deps.out(JSON.stringify({ enabled: true, remote: true }));
  return 0;
}

async function runRaise(intent: GateIntent, deps: GateDeps): Promise<number> {
  if (!isGateType(intent.type)) {
    deps.err(red(`error: --type must be one of ${GATE_TYPES.join(", ")}.`));
    return 1;
  }
  if (!intent.title) {
    deps.err(red("error: --title is required."));
    return 1;
  }
  let payload: Record<string, unknown>;
  try {
    payload = intent.payload ? (JSON.parse(intent.payload) as Record<string, unknown>) : {};
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new Error("payload must be a JSON object");
    }
  } catch (e) {
    deps.err(red(`error: --payload is not a JSON object: ${e instanceof Error ? e.message : e}`));
    return 1;
  }

  const session = await deps.buildSession();
  if (!session) {
    deps.err(red("error: project is not Cloud-linked (run `specnaut cloud login`)."));
    return 5;
  }

  const req: GateRequest = {
    projectKey: "", // filled by the session from config
    type: intent.type as GateType,
    title: intent.title,
    payload,
    ...(intent.task !== null ? { taskNumber: intent.task } : {}),
  };

  return await reportRaise(await session.raiseAndAwait(req), session, deps);
}

/** Print a raise's outcome; the exit code tells the phase which it was. */
async function reportRaise(
  outcome: ResolutionOutcome,
  session: GateSession,
  deps: GateDeps,
): Promise<number> {
  switch (outcome.kind) {
    case "answered": {
      // Acknowledge consumption (idempotent). The answer is what the phase needs,
      // so an apply hiccup is a warning, not a failure of the raise.
      const applied = await session.apply(outcome.gate);
      if (applied.kind === "error") {
        deps.err(yellow("warning: answer received but apply (ack) did not complete; continuing."));
      }
      deps.out(terminalJson(outcome.answer));
      return 0;
    }
    case "unresolved":
      deps.err(yellow("gate timed out before it was resolved."));
      return 3;
    case "cancelled":
      deps.err(yellow("gate was cancelled before it was resolved."));
      return 4;
    case "error":
      if (outcome.reason === "no_remote") {
        deps.err(red(`error: ${FAILURE.no_remote}`));
        return 5;
      }
      // Raising is the one command with those flags, and the check is partly local.
      deps.err(
        red(
          `error: gate could not be resolved: ${
            outcome.reason === "invalid"
              ? "the gate is invalid; check --type and --payload."
              : FAILURE[outcome.reason]
          }`,
        ),
      );
      return 1;
    default:
      return 1;
  }
}

async function runCancel(intent: GateIntent, deps: GateDeps): Promise<number> {
  if (!intent.id) {
    deps.err(red("error: `specnaut gate cancel` requires a gate id."));
    return 1;
  }
  const session = await deps.buildSession();
  if (!session) {
    deps.err(red("error: project is not Cloud-linked (run `specnaut cloud login`)."));
    return 5;
  }
  const outcome = await session.cancel(intent.id);
  if (outcome.kind === "cancelled") {
    deps.out(JSON.stringify({ state: "cancelled" }));
    return 0;
  }
  const why = outcome.kind === "error" ? FAILURE[outcome.reason] : `it is ${outcome.kind}.`;
  deps.err(red(`error: could not cancel gate: ${why}`));
  return 1;
}
