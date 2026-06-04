// Agent-side types + guards for the public gate wire contract (docs/api/gates.md,
// #356). This module is PURE — no IO. It mirrors the versioned `/api/v1` gate
// object exactly; nothing Cloud-internal is modelled here (constitution § I).
//
// The CLI is the *agent*: it opens, awaits, applies, and cancels gates. It never
// *resolves* one (that is the human action, performed elsewhere). Per the
// contract, consumers MUST ignore unknown fields and unknown `type`/`state`
// enum values rather than erroring — so the guards below only *branch* behaviour,
// they never reject an unrecognised value.

/** The five gate types the contract enumerates today. */
export const GATE_TYPES = [
  "clarification",
  "decision",
  "plan_approval",
  "merge_approval",
  "agent_unblock",
] as const;
export type GateType = (typeof GATE_TYPES)[number];

/** The four lifecycle states. */
export const GATE_STATES = ["open", "answered", "applied", "cancelled"] as const;
export type GateState = (typeof GATE_STATES)[number];

/**
 * The agent's read view of a gate object. `type`/`state` are widened to also
 * admit unknown future values (forward-compat); guards narrow them for branching.
 */
export type Gate = {
  id: string;
  projectKey: string;
  taskNumber?: number;
  type: GateType | string;
  title: string;
  payload: Record<string, unknown>;
  state: GateState | string;
  answer: Record<string, unknown> | null;
  createdBy: string;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

/** Inputs an agent supplies to open a gate. */
export type GateRequest = {
  projectKey: string;
  type: GateType;
  title: string;
  payload: Record<string, unknown>;
  taskNumber?: number;
};

export function isGateType(v: unknown): v is GateType {
  return typeof v === "string" && (GATE_TYPES as readonly string[]).includes(v);
}

export function isGateState(v: unknown): v is GateState {
  return typeof v === "string" && (GATE_STATES as readonly string[]).includes(v);
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

/**
 * Defensive projection of a wire gate object. Returns null on a structurally
 * invalid body (missing id/state) so the await loop can treat it as "no gate yet"
 * rather than throwing. Unknown extra fields are ignored; `type`/`state` pass
 * through verbatim even when unrecognised.
 */
export function parseGate(json: unknown): Gate | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id === "") return null;
  if (typeof o.state !== "string") return null;
  return {
    id: o.id,
    projectKey: typeof o.projectKey === "string" ? o.projectKey : "",
    taskNumber: typeof o.taskNumber === "number" ? o.taskNumber : undefined,
    type: typeof o.type === "string" ? o.type : "",
    title: typeof o.title === "string" ? o.title : "",
    payload: asRecord(o.payload),
    state: o.state,
    answer: o.answer === null || o.answer === undefined ? null : asRecord(o.answer),
    createdBy: typeof o.createdBy === "string" ? o.createdBy : "",
    resolvedBy: typeof o.resolvedBy === "string" ? o.resolvedBy : null,
    createdAt: typeof o.createdAt === "string" ? o.createdAt : "",
    resolvedAt: typeof o.resolvedAt === "string" ? o.resolvedAt : null,
  };
}

/** Result of a local payload pre-check (fail fast before the network call). */
export type PayloadCheck = { ok: true } | { ok: false; error: string };

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * Lightweight client-side payload validation per gate type. The backend remains
 * the authority (it returns 422); this only spares an obvious round-trip and
 * gives the caller a clear local error. Mirrors the `payload` column of the
 * contract's "Gate types" table.
 */
export function validatePayload(type: GateType, payload: Record<string, unknown>): PayloadCheck {
  switch (type) {
    case "clarification":
      return isNonEmptyString(payload.question)
        ? { ok: true }
        : { ok: false, error: "clarification payload requires a non-empty `question`" };
    case "decision": {
      const opts = payload.options;
      if (!Array.isArray(opts) || opts.length === 0) {
        return { ok: false, error: "decision payload requires a non-empty `options` array" };
      }
      const ids = new Set<string>();
      for (const opt of opts) {
        const id = (opt as Record<string, unknown>)?.id;
        if (!isNonEmptyString(id)) {
          return { ok: false, error: "each decision option requires a non-empty `id`" };
        }
        if (ids.has(id)) return { ok: false, error: `duplicate decision option id: ${id}` };
        ids.add(id);
      }
      return isNonEmptyString(payload.question)
        ? { ok: true }
        : { ok: false, error: "decision payload requires a non-empty `question`" };
    }
    case "plan_approval":
    case "merge_approval":
      return isNonEmptyString(payload.summary)
        ? { ok: true }
        : { ok: false, error: `${type} payload requires a non-empty \`summary\`` };
    case "agent_unblock":
      return isNonEmptyString(payload.reason)
        ? { ok: true }
        : { ok: false, error: "agent_unblock payload requires a non-empty `reason`" };
  }
}
