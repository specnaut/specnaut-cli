import { DELIMITER, dirname, fromFileUrl, join } from "@std/path";
import { installWriterDeps } from "../scripts/backlog_tracker_fixture.ts";

/**
 * Shared harness for the groom-completeness tests (US4 / FR-005).
 *
 * `groom-rules.sh` is the one home of "what makes a groomed item complete"
 * (plan § 5); each backend's `groom-verify.sh` only fetches and normalises.
 * So the rules are tested once, directly (`groom_rules_test.ts`), and each
 * backend through its real script, in a project laid out the way `init`
 * installs it, against a stubbed `gh` / `glab` / `curl` on PATH
 * (`groom_verify_test.ts`, `groom_verify_remote_test.ts`). Nothing here
 * restates a rule.
 */

export const TEMPLATES = fromFileUrl(new URL("../../templates/", import.meta.url));
export const RULES = join(TEMPLATES, "core/specnaut/scripts/bash/groom-rules.sh");
export const BOARD_SCRIPTS = join(TEMPLATES, "core/skills/task/scripts");

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

export async function run(
  cmd: string,
  args: string[],
  opts: { stdin?: string; env?: Record<string, string>; cwd?: string } = {},
): Promise<Run> {
  const child = new Deno.Command(cmd, {
    args,
    cwd: opts.cwd,
    env: opts.env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const w = child.stdin.getWriter();
  await w.write(new TextEncoder().encode(opts.stdin ?? ""));
  await w.close();
  const out = await child.output();
  const dec = new TextDecoder();
  return { code: out.code, stdout: dec.decode(out.stdout), stderr: dec.decode(out.stderr) };
}

/** A body carrying every section, each filled. */
export const FULL_BODY = [
  "## Why",
  "Exports time out past 10k rows.",
  "",
  "## Acceptance criteria",
  "- [ ] the export pages",
  "",
  "## Out of scope",
  "CSV dialects.",
  "",
  "## Notes",
  "none",
].join("\n");

/** A project with one backend's scripts installed flat, plus the shared rules. */
export async function project(backend: string, files: string[], config?: string) {
  const dir = await Deno.makeTempDir({ prefix: "groom-verify-" });
  const scripts = join(dir, ".specnaut/scripts/backlog");
  const bash = join(dir, ".specnaut/scripts/bash");
  await Deno.mkdir(scripts, { recursive: true });
  await Deno.mkdir(bash, { recursive: true });
  await Deno.mkdir(join(dir, "bin"));
  for (const f of ["_config.sh", "groom-verify.sh", "item-record.sh", ...files]) {
    await Deno.copyFile(join(BOARD_SCRIPTS, backend, f), join(scripts, f));
  }
  // The shared files installed beside every backend: the character rule cloud's
  // `_config.sh` sources, the plan rules the local add.sh checks a title by, and
  // the secret scan the writers run.
  await installWriterDeps(scripts);
  // groom-rules.sh sources common.sh (its CR-safe jq), which sources the git
  // probe and the template resolver: the four are installed side by side.
  for (
    const f of [
      "groom-rules.sh",
      "common.sh",
      "_git_probe.sh",
      "_feature_json.sh",
      "template-resolution.sh",
    ]
  ) {
    await Deno.copyFile(join(dirname(RULES), f), join(bash, f));
  }
  if (config) await Deno.writeTextFile(join(dir, ".specnaut/backlog-config.yml"), config);
  return {
    dir,
    async stub(name: string, body: string) {
      await Deno.writeTextFile(join(dir, "bin", name), `#!/usr/bin/env bash\n${body}`);
      await Deno.chmod(join(dir, "bin", name), 0o755);
    },
    /**
     * Make `jq` write CRLF, as a native Windows jq.exe does (every `\n` as
     * `\r\n`). On Windows the real one already does, and wrapping it would
     * double each `\r`, so it is left as it is.
     */
    async crlfJq() {
      if (Deno.build.os === "windows") return;
      const real = await run("bash", ["-c", "command -v jq"]);
      await this.stub(
        "jq",
        `set -o pipefail\n"${real.stdout.trim()}" "$@" | perl -pe 's/\\n/\\r\\n/'\n`,
      );
    },
    verify(...args: string[]): Promise<Run> {
      return run("bash", [join(scripts, "groom-verify.sh"), ...args], {
        cwd: dir,
        env: {
          PATH: `${join(dir, "bin")}${DELIMITER}${Deno.env.get("PATH")}`,
          HOME: dir,
          FIXTURES: dir,
        },
      });
    },
    cleanup: () => Deno.remove(dir, { recursive: true }),
  };
}
