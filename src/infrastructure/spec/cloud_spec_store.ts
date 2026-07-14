import type { SpecStore } from "../../application/ports.ts";
import type { SpecStep } from "../../domain/spec/spec_step.ts";
import type { SpecSession } from "../../domain/cloud/spec_session.ts";

/**
 * The `cloud` spec backend adapter (spec 020, D1). A thin bridge from the
 * {@link SpecStore} port onto a {@link SpecSession} — all HTTP, auth, and the
 * § I boundary live in the session/client. `pull` returns `null` when the task
 * has no cloud spec yet (a clean "nothing to materialise", not an error);
 * `push` is upsert-only.
 */
export class CloudSpecStore implements SpecStore {
  readonly key = "cloud" as const;

  constructor(private readonly session: SpecSession) {}

  pull(taskNumber: number): Promise<readonly SpecStep[] | null> {
    return this.session.pull(taskNumber);
  }

  push(taskNumber: number, steps: readonly SpecStep[]): Promise<void> {
    return this.session.push(taskNumber, steps);
  }
}
