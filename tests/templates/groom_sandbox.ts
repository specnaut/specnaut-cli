import { fromFileUrl, join } from "@std/path";

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
export const BOARD_SCRIPTS = join(TEMPLATES, "core/skills/board/scripts");

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
  for (const f of ["_config.sh", "groom-verify.sh", ...files]) {
    await Deno.copyFile(join(BOARD_SCRIPTS, backend, f), join(scripts, f));
  }
  await Deno.copyFile(RULES, join(bash, "groom-rules.sh"));
  if (config) await Deno.writeTextFile(join(dir, ".specnaut/backlog-config.yml"), config);
  return {
    dir,
    async stub(name: string, body: string) {
      await Deno.writeTextFile(join(dir, "bin", name), `#!/usr/bin/env bash\n${body}`);
      await Deno.chmod(join(dir, "bin", name), 0o755);
    },
    verify(...args: string[]): Promise<Run> {
      return run("bash", [join(scripts, "groom-verify.sh"), ...args], {
        cwd: dir,
        env: { PATH: `${join(dir, "bin")}:${Deno.env.get("PATH")}`, HOME: dir, FIXTURES: dir },
      });
    },
    cleanup: () => Deno.remove(dir, { recursive: true }),
  };
}
