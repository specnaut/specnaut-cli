import { assertEquals, assertRejects } from "@std/assert";
import { GhCli } from "../../src/infrastructure/gh_cli.ts";
import type {
  SubprocessOptions,
  SubprocessResult,
  SubprocessRunner,
} from "../../src/application/ports.ts";

function fakeRunner(
  handler: (cmd: string, args: string[], opts?: SubprocessOptions) => SubprocessResult,
): SubprocessRunner & { calls: Array<{ cmd: string; args: string[]; opts?: SubprocessOptions }> } {
  const calls: Array<{ cmd: string; args: string[]; opts?: SubprocessOptions }> = [];
  return {
    calls,
    run: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return Promise.resolve(handler(cmd, args, opts));
    },
  };
}

Deno.test("GhCli.isAvailable returns true when gh --version exits 0", async () => {
  const runner = fakeRunner(() => ({ code: 0, stdout: "gh version 2.50.0", stderr: "" }));
  const gh = new GhCli(runner);
  assertEquals(await gh.isAvailable(), true);
  assertEquals(runner.calls[0].args, ["--version"]);
});

Deno.test("GhCli.isAvailable returns false when gh missing", async () => {
  const runner = fakeRunner(() => ({ code: 127, stdout: "", stderr: "command not found" }));
  const gh = new GhCli(runner);
  assertEquals(await gh.isAvailable(), false);
});

Deno.test("GhCli.isAuthenticated returns true on exit 0", async () => {
  const runner = fakeRunner(() => ({ code: 0, stdout: "Logged in", stderr: "" }));
  const gh = new GhCli(runner);
  assertEquals(await gh.isAuthenticated(), true);
  assertEquals(runner.calls[0].args, ["auth", "status"]);
});

Deno.test("GhCli.createIssue passes title and body-file", async () => {
  const runner = fakeRunner(() => ({
    code: 0,
    stdout: "https://github.com/o/r/issues/42",
    stderr: "",
  }));
  const gh = new GhCli(runner);
  const number = await gh.createIssue({
    repo: "o/r",
    title: "Hello",
    bodyPath: "/tmp/body.md",
    labels: ["backlog/001", "priority/high"],
  });
  assertEquals(number, 42);
  const args = runner.calls[0].args;
  assertEquals(args.slice(0, 3), ["issue", "create", "--repo"]);
  assertEquals(args.includes("--body-file"), true);
  assertEquals(args.includes("/tmp/body.md"), true);
  assertEquals(args.includes("--label"), true);
});

Deno.test("GhCli.editIssue passes edit args", async () => {
  const runner = fakeRunner(() => ({ code: 0, stdout: "", stderr: "" }));
  const gh = new GhCli(runner);
  await gh.editIssue({
    repo: "o/r",
    number: 42,
    title: "new",
    bodyPath: "/tmp/b.md",
    addLabels: ["x"],
    removeLabels: ["y"],
  });
  const args = runner.calls[0].args;
  assertEquals(args.slice(0, 4), ["issue", "edit", "42", "--repo"]);
  assertEquals(args.includes("--add-label"), true);
  assertEquals(args.includes("--remove-label"), true);
});

Deno.test("GhCli.closeIssue passes --reason", async () => {
  const runner = fakeRunner(() => ({ code: 0, stdout: "", stderr: "" }));
  const gh = new GhCli(runner);
  await gh.closeIssue("o/r", 42, "completed");
  const args = runner.calls[0].args;
  assertEquals(args.slice(0, 4), ["issue", "close", "42", "--repo"]);
  assertEquals(args.includes("--reason"), true);
  assertEquals(args.includes("completed"), true);
});

Deno.test("GhCli.listIssues parses JSON output into rows", async () => {
  const json = JSON.stringify([
    { number: 1, state: "OPEN", labels: [{ name: "backlog/001" }] },
    { number: 2, state: "CLOSED", labels: [{ name: "backlog/002" }, { name: "other" }] },
  ]);
  const runner = fakeRunner(() => ({ code: 0, stdout: json, stderr: "" }));
  const gh = new GhCli(runner);
  const issues = await gh.listIssues("o/r", "backlog/");
  assertEquals(issues.length, 2);
  assertEquals(issues[0].number, 1);
  assertEquals(issues[0].state, "open");
  assertEquals(issues[1].state, "closed");
});

Deno.test("GhCli.createIssue throws on non-zero exit", async () => {
  const runner = fakeRunner(() => ({ code: 1, stdout: "", stderr: "forbidden" }));
  const gh = new GhCli(runner);
  await assertRejects(
    () => gh.createIssue({ repo: "o/r", title: "x", bodyPath: "/tmp/b.md", labels: [] }),
    Error,
    "gh issue create",
  );
});
