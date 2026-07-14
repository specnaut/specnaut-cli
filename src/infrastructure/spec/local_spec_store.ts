import type { SpecStore } from "../../application/ports.ts";
import type { SpecStep } from "../../domain/spec/spec_step.ts";

/**
 * The `local` spec backend adapter (spec 020, D1). `spec push` / `spec pull` are
 * cloud-only verbs — there is no remote spec to sync when specs are plain
 * `.specnaut/specs/` markdown files. Both verbs reject with one clear, actionable
 * message so a misdirected call never silently succeeds or produces an empty
 * spec. The local authoring flow never routes through this store (it bypasses
 * the port entirely, preserving byte-identical behaviour — FR-003).
 */
export class LocalSpecStore implements SpecStore {
  readonly key = "local" as const;

  private cloudOnly(): never {
    throw new Error(
      "spec push/pull are cloud-backend commands — this project uses the local spec " +
        "backend (.specnaut/specs/ markdown). Re-run `specnaut init --spec-backend cloud` " +
        "to host specs on SpecNaut Cloud.",
    );
  }

  // `async` so the guard surfaces as a rejected promise (the SpecStore contract),
  // not a synchronous throw — callers uniformly `await` it.
  pull(_taskNumber: number): Promise<readonly SpecStep[] | null> {
    return Promise.resolve().then(() => this.cloudOnly());
  }

  push(_taskNumber: number, _steps: readonly SpecStep[]): Promise<void> {
    return Promise.resolve().then(() => this.cloudOnly());
  }
}
