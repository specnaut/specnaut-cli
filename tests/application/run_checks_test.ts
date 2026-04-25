import { assertEquals } from "@std/assert";
import { RunChecksUseCase } from "../../src/application/run_checks.ts";
import type { EnvironmentProbe, ProjectInspector } from "../../src/application/ports.ts";
import type { CheckOutcome } from "../../src/domain/check_result.ts";

const allPassEnv: EnvironmentProbe = {
  probeGit: () => Promise.resolve({ name: "git", status: "pass", message: "2.43" }),
  probeGh: () => Promise.resolve({ name: "gh", status: "pass", message: "2.50 (authed)" }),
  probeDeno: () => Promise.resolve({ name: "deno", status: "pass", message: "2.0" }),
};

const failedGitEnv: EnvironmentProbe = {
  probeGit: () => Promise.resolve({ name: "git", status: "fail", message: "missing" }),
  probeGh: () => Promise.resolve({ name: "gh", status: "pass", message: "2.50" }),
  probeDeno: () => Promise.resolve({ name: "deno", status: "warn", message: "missing" }),
};

function fakeInspector(outcomes: CheckOutcome[]): ProjectInspector {
  return { inspect: () => Promise.resolve(outcomes) };
}

Deno.test("RunChecksUseCase without projectDir runs env probes only", async () => {
  const uc = new RunChecksUseCase({
    env: allPassEnv,
    inspector: fakeInspector([]),
  });
  const result = await uc.execute({ projectDir: null, templatesVersion: "0.2.0" });
  assertEquals(result.environment.length, 3);
  assertEquals(result.project.length, 0);
});

Deno.test("RunChecksUseCase with projectDir runs both sections", async () => {
  const uc = new RunChecksUseCase({
    env: allPassEnv,
    inspector: fakeInspector([
      { name: ".specflow/", status: "pass", message: "present" },
      { name: ".claude/", status: "pass", message: "present" },
    ]),
  });
  const result = await uc.execute({ projectDir: "/p", templatesVersion: "0.2.0" });
  assertEquals(result.environment.length, 3);
  assertEquals(result.project.length, 2);
});

Deno.test("RunChecksUseCase propagates failures from env", async () => {
  const uc = new RunChecksUseCase({
    env: failedGitEnv,
    inspector: fakeInspector([]),
  });
  const result = await uc.execute({ projectDir: null, templatesVersion: "0.2.0" });
  const git = result.environment.find((o) => o.name === "git");
  assertEquals(git?.status, "fail");
});

Deno.test("RunChecksUseCase propagates failures from project inspector", async () => {
  const uc = new RunChecksUseCase({
    env: allPassEnv,
    inspector: fakeInspector([
      { name: ".specflow/", status: "fail", message: "missing" },
    ]),
  });
  const result = await uc.execute({ projectDir: "/p", templatesVersion: "0.2.0" });
  const specify = result.project.find((o) => o.name === ".specflow/");
  assertEquals(specify?.status, "fail");
});
