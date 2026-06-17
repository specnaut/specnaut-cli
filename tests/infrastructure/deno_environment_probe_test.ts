import { assertEquals } from "@std/assert";
import { DenoEnvironmentProbe } from "../../src/infrastructure/deno_environment_probe.ts";
import type {
  SubprocessOptions,
  SubprocessResult,
  SubprocessRunner,
} from "../../src/application/ports.ts";

function fakeRunner(
  handler: (cmd: string, args: string[]) => SubprocessResult,
): SubprocessRunner {
  return {
    run: (cmd, args, _opts?: SubprocessOptions) => Promise.resolve(handler(cmd, args)),
  };
}

Deno.test("probeGit returns pass with version on exit 0", async () => {
  const runner = fakeRunner(() => ({
    code: 0,
    stdout: "git version 2.43.0 (Apple)",
    stderr: "",
  }));
  const probe = new DenoEnvironmentProbe(runner);
  const outcome = await probe.probeGit();
  assertEquals(outcome.status, "pass");
  assertEquals(outcome.message.includes("2.43.0"), true);
});

Deno.test("probeGit returns fail when binary missing", async () => {
  const runner = fakeRunner(() => ({ code: 127, stdout: "", stderr: "not found" }));
  const probe = new DenoEnvironmentProbe(runner);
  const outcome = await probe.probeGit();
  assertEquals(outcome.status, "fail");
});

Deno.test("probeGh parses login from stderr (legacy gh < 2.7)", async () => {
  const runner = fakeRunner((_cmd, args) => {
    if (args[0] === "--version") {
      return { code: 0, stdout: "gh version 2.50.0", stderr: "" };
    }
    return {
      code: 0,
      stdout: "",
      stderr: "✓ Logged in to github.com account kevinraimbaud",
    };
  });
  const probe = new DenoEnvironmentProbe(runner);
  const outcome = await probe.probeGh();
  assertEquals(outcome.status, "pass");
  assertEquals(outcome.message.includes("2.50.0"), true);
  assertEquals(outcome.message.includes("kevinraimbaud"), true);
});

Deno.test("probeGh parses login from stdout (gh 2.7+ — real 2.92.0 output)", async () => {
  const runner = fakeRunner((_cmd, args) => {
    if (args[0] === "--version") {
      return { code: 0, stdout: "gh version 2.92.0 (2026-04-15)", stderr: "" };
    }
    // Verbatim shape of `gh auth status` on gh 2.92.0
    return {
      code: 0,
      stdout: "github.com\n" +
        "  ✓ Logged in to github.com account kevinkod (keyring)\n" +
        "  - Active account: true\n" +
        "  - Git operations protocol: ssh\n" +
        "  - Token: gho_************************************\n" +
        "  - Token scopes: 'admin:public_key', 'gist', 'project'\n",
      stderr: "",
    };
  });
  const probe = new DenoEnvironmentProbe(runner);
  const outcome = await probe.probeGh();
  assertEquals(outcome.status, "pass");
  assertEquals(outcome.message.includes("2.92.0"), true);
  assertEquals(outcome.message.includes("kevinkod"), true);
  assertEquals(outcome.message.includes("unknown"), false);
});

Deno.test("probeGh returns warn when installed but not authenticated", async () => {
  const runner = fakeRunner((_cmd, args) => {
    if (args[0] === "--version") {
      return { code: 0, stdout: "gh version 2.50.0", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "You are not logged into any GitHub hosts" };
  });
  const probe = new DenoEnvironmentProbe(runner);
  const outcome = await probe.probeGh();
  assertEquals(outcome.status, "warn");
  assertEquals(outcome.message.includes("not authenticated"), true);
});

Deno.test("probeGh returns fail when missing", async () => {
  const runner = fakeRunner(() => ({ code: 127, stdout: "", stderr: "" }));
  const probe = new DenoEnvironmentProbe(runner);
  const outcome = await probe.probeGh();
  assertEquals(outcome.status, "fail");
});

Deno.test("probeDeno returns warn when missing (not required)", async () => {
  const runner = fakeRunner(() => ({ code: 127, stdout: "", stderr: "" }));
  const probe = new DenoEnvironmentProbe(runner);
  const outcome = await probe.probeDeno();
  assertEquals(outcome.status, "warn");
  assertEquals(
    outcome.message,
    "deno not found in PATH (optional — only needed for Specnaut development)",
  );
});
