// Agent-side types + guards for the public spec wire contract (spec 020,
// consuming Lot 1's `/api/v1/specs*`). This module is PURE — no IO. It mirrors
// the versioned `/api/v1` spec object exactly; nothing Cloud-internal is
// modelled here (constitution § I).
//
// Per the contract, consumers MUST ignore unknown fields rather than erroring,
// so the guards below defensively project the wire body and drop anything they
// don't recognise. The only shape that crosses the boundary is
// SpecStep{key,name,order,body} plus the public projectKey / taskNumber.

import type { SpecStep } from "../spec/spec_step.ts";

/** One step as it travels on the wire — structurally the domain {@link SpecStep}. */
export type SpecStepWire = SpecStep;

/** A task's spec as returned by `GET /api/v1/specs`. */
export type SpecWire = {
  taskNumber: number;
  title: string;
  steps: SpecStep[];
};

/**
 * A spec version descriptor (`versionKey` is opaque). Modelled for
 * completeness of the read surface; the CLI only ever displays it, never
 * reasons about the Cloud-internal id behind it (§ I).
 */
export type SpecVersionWire = {
  versionKey: string;
  source: string;
  author: string;
  createdAt: string;
};

/**
 * Defensive projection of a single wire step. Returns null when the step is
 * structurally unusable (missing/empty `key`) so callers can skip it rather
 * than surface a half-formed spec. Unknown extra fields are ignored.
 */
export function parseSpecStep(json: unknown): SpecStep | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  if (typeof o.key !== "string" || o.key === "") return null;
  return {
    key: o.key,
    name: typeof o.name === "string" ? o.name : o.key,
    order: typeof o.order === "number" && Number.isFinite(o.order) ? o.order : 0,
    body: typeof o.body === "string" ? o.body : "",
  };
}

/**
 * Defensive projection of a wire spec object. Returns null on a structurally
 * invalid body (no `taskNumber`) so a `pull` can treat it as "no spec yet"
 * rather than throwing. Steps that fail {@link parseSpecStep} are dropped, and
 * the survivors are sorted by `order` so materialisation is deterministic.
 */
export function parseSpec(json: unknown): SpecWire | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  if (typeof o.taskNumber !== "number" || !Number.isFinite(o.taskNumber)) return null;
  const rawSteps = Array.isArray(o.steps) ? o.steps : [];
  const steps: SpecStep[] = [];
  for (const r of rawSteps) {
    const step = parseSpecStep(r);
    if (step) steps.push(step);
  }
  steps.sort((a, b) => a.order - b.order);
  return {
    taskNumber: o.taskNumber,
    title: typeof o.title === "string" ? o.title : "",
    steps,
  };
}
