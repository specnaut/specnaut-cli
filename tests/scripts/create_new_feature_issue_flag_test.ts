// Integration tests for `create-new-feature.sh --issue <id>`.
//
// The script is the only place where a user-invoked CLI flag flows
// into `feature.json` and (later) into the merge phase's auto-close
// behavior, so the JSON contract on this seam is load-bearing.

import { assert, assertEquals } from "@std/assert";

const SCRIPT_PATH = new URL(
  "../../templates/core/specflow/scripts/bash/create-new-feature.sh",
  import.meta.url,
).pathname;

async function runScript(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command("bash", {
    args: [SCRIPT_PATH, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function withTempProject<T>(
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "cnf-issue-test-" });
  try {
    const initCmd = new Deno.Command("git", {
      args: ["init", "-q"],
      cwd: dir,
    });
    await initCmd.output();
    return await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test(
  "create-new-feature.sh --json --dry-run includes LINKED_ISSUE: <id> when --issue is provided",
  async () => {
    await withTempProject(async (dir) => {
      const { code, stdout } = await runScript(
        ["--json", "--dry-run", "--short-name", "test", "--issue", "42", "feature"],
        dir,
      );
      assertEquals(code, 0);
      const json = JSON.parse(stdout.trim());
      assertEquals(json.LINKED_ISSUE, 42);
      assertEquals(json.BRANCH_NAME, "001-test");
    });
  },
);

Deno.test(
  "create-new-feature.sh --json --dry-run emits LINKED_ISSUE: null when --issue is omitted",
  async () => {
    await withTempProject(async (dir) => {
      const { code, stdout } = await runScript(
        ["--json", "--dry-run", "--short-name", "test", "feature"],
        dir,
      );
      assertEquals(code, 0);
      const json = JSON.parse(stdout.trim());
      assertEquals(json.LINKED_ISSUE, null);
    });
  },
);

Deno.test(
  "create-new-feature.sh --issue rejects non-integer values",
  async () => {
    await withTempProject(async (dir) => {
      const { code, stderr } = await runScript(
        [
          "--json",
          "--dry-run",
          "--short-name",
          "test",
          "--issue",
          "not-a-number",
          "feature",
        ],
        dir,
      );
      assert(code !== 0, "expected non-zero exit on bad --issue value");
      assert(
        stderr.includes("--issue must be a positive integer"),
        `stderr should explain the rejection, got: ${stderr}`,
      );
    });
  },
);

Deno.test(
  "create-new-feature.sh --issue rejects zero (not a valid issue id)",
  async () => {
    await withTempProject(async (dir) => {
      const { code } = await runScript(
        ["--json", "--dry-run", "--short-name", "test", "--issue", "0", "feature"],
        dir,
      );
      assert(code !== 0, "expected non-zero exit on --issue 0");
    });
  },
);

Deno.test(
  "create-new-feature.sh --issue rejects negative numbers",
  async () => {
    await withTempProject(async (dir) => {
      const { code } = await runScript(
        [
          "--json",
          "--dry-run",
          "--short-name",
          "test",
          "--issue",
          "-5",
          "feature",
        ],
        dir,
      );
      assert(code !== 0, "expected non-zero exit on --issue -5");
    });
  },
);

Deno.test(
  "create-new-feature.sh --issue rejects when value is missing",
  async () => {
    await withTempProject(async (dir) => {
      const { code, stderr } = await runScript(
        ["--json", "--dry-run", "--short-name", "test", "--issue"],
        dir,
      );
      assert(code !== 0);
      assert(
        stderr.includes("--issue requires a value"),
        `expected helpful error, got: ${stderr}`,
      );
    });
  },
);

Deno.test(
  "create-new-feature.sh non-JSON mode prints LINKED_ISSUE line only when set",
  async () => {
    await withTempProject(async (dir) => {
      const withIssue = await runScript(
        ["--dry-run", "--short-name", "test", "--issue", "7", "feature"],
        dir,
      );
      assertEquals(withIssue.code, 0);
      assert(
        withIssue.stdout.includes("LINKED_ISSUE: 7"),
        `expected LINKED_ISSUE: 7 in stdout, got: ${withIssue.stdout}`,
      );

      const withoutIssue = await runScript(
        ["--dry-run", "--short-name", "test2", "feature"],
        dir,
      );
      assertEquals(withoutIssue.code, 0);
      assert(
        !withoutIssue.stdout.includes("LINKED_ISSUE"),
        `LINKED_ISSUE line should be omitted when unset, got: ${withoutIssue.stdout}`,
      );
    });
  },
);
