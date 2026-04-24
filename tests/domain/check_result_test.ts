import { assertEquals } from "@std/assert";
import {
  type CheckOutcome,
  type CheckResult,
  worstStatusOf,
} from "../../src/domain/check_result.ts";

Deno.test("worstStatusOf returns 'pass' for empty list", () => {
  assertEquals(worstStatusOf([]), "pass");
});

Deno.test("worstStatusOf returns 'pass' when all outcomes pass", () => {
  const outcomes: CheckOutcome[] = [
    { name: "git", status: "pass", message: "ok" },
    { name: "gh", status: "pass", message: "ok" },
  ];
  assertEquals(worstStatusOf(outcomes), "pass");
});

Deno.test("worstStatusOf returns 'warn' when at least one warn and no fail", () => {
  const outcomes: CheckOutcome[] = [
    { name: "git", status: "pass", message: "ok" },
    { name: "deno", status: "warn", message: "missing" },
  ];
  assertEquals(worstStatusOf(outcomes), "warn");
});

Deno.test("worstStatusOf returns 'fail' when any fail", () => {
  const outcomes: CheckOutcome[] = [
    { name: "git", status: "fail", message: "not found" },
    { name: "deno", status: "warn", message: "missing" },
    { name: "gh", status: "pass", message: "ok" },
  ];
  assertEquals(worstStatusOf(outcomes), "fail");
});

Deno.test("CheckResult groups environment + project sections", () => {
  const result: CheckResult = {
    environment: [{ name: "git", status: "pass", message: "ok" }],
    project: [{ name: ".specify/", status: "pass", message: "present" }],
  };
  assertEquals(result.environment.length, 1);
  assertEquals(result.project.length, 1);
});
