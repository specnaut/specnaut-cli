export type CheckStatus = "pass" | "warn" | "fail";

export type CheckOutcome = {
  readonly name: string;
  readonly status: CheckStatus;
  readonly message: string;
};

export type CheckResult = {
  readonly environment: ReadonlyArray<CheckOutcome>;
  readonly project: ReadonlyArray<CheckOutcome>;
};

export function worstStatusOf(outcomes: ReadonlyArray<CheckOutcome>): CheckStatus {
  let worst: CheckStatus = "pass";
  for (const o of outcomes) {
    if (o.status === "fail") return "fail";
    if (o.status === "warn") worst = "warn";
  }
  return worst;
}
