import { fromFileUrl, join } from "@std/path";

/**
 * One backend's backlog scripts installed the way `init` lays them out —
 * flat, at `.specnaut/scripts/backlog/` — with the tracker CLIs they call
 * (`gh`, `glab`, `curl`, `specnaut cloud token`) replaced on PATH by stand-ins
 * that record every argv to `calls.log` and answer just enough for a script to
 * go on. What a test reads back is what reached the tracker, not what the
 * script meant to send.
 */

export const SCRIPTS = fromFileUrl(
  new URL("../../templates/core/skills/task/scripts/", import.meta.url),
);
export const BACKENDS = ["github", "gitlab", "local", "cloud"] as const;
/** The spec family's shared helpers (`jq_lf`, the secret scan), which a shared backlog script sources. */
const BASH = fromFileUrl(new URL("../../templates/core/specnaut/scripts/bash/", import.meta.url));
export type Backend = typeof BACKENDS[number];

const CONFIG: Record<Backend, string | null> = {
  github: 'repo: "acme/my-app"\nproject_number: 7\n',
  gitlab: "host: https://gitlab.example.com\nproject_id: acme/my-app\n",
  cloud: 'backend: cloud\napi_url: "http://127.0.0.1:9"\nproject_key: K\n',
  local: null,
};

/**
 * Each stand-in logs one line per call: its name, then every argument on its
 * own `\t` field, a newline inside an argument folded to a space (a JSON
 * payload stays parseable).
 */
const LOG = `printf '%s' "\${0##*/}" >> "$FAKE_ROOT/calls.log"
for a in "$@"; do printf '\\t%s' "\${a//$'\\n'/ }" >> "$FAKE_ROOT/calls.log"; done
echo >> "$FAKE_ROOT/calls.log"`;

const FAKES: Record<string, string> = {
  gh: `${LOG}
case "$1 \${2:-}" in
  "issue create") echo "https://github.com/acme/my-app/issues/5" ;;
esac
exit 0`,
  glab: `${LOG}
case "$1 \${2:-}" in
  "issue create") echo "https://gitlab.example.com/acme/my-app/-/issues/5" ;;
  *) echo '{}' ;;
esac
exit 0`,
  // cloud_curl hands the Authorization header on stdin and reads the status
  // code from the last line (-w '\\n%{http_code}').
  curl: `${LOG}
cat >/dev/null
printf '{"ok":true,"task":{"key":"K-5","number":5}}\\n200'`,
  specnaut: "echo tok-fixture",
};

export interface Result {
  code: number;
  stdout: string;
  stderr: string;
  /** Every tracker call, one per line: `gh\tissue\tview\t7…`. */
  calls: string;
}

export interface Project {
  dir: string;
  /** `env` is added to the inherited environment (`TMPDIR`, say). */
  run(script: string, args: string[], env?: Record<string, string>): Promise<Result>;
  read(rel: string): Promise<string>;
  write(rel: string, text: string): Promise<void>;
  cleanup(): Promise<void>;
}

/** A fresh project holding `backend`'s scripts, its config, and the stand-ins. */
export async function project(backend: Backend): Promise<Project> {
  const dir = await Deno.makeTempDir({ prefix: `backlog-${backend}-` });
  const scripts = join(dir, ".specnaut", "scripts", "backlog");
  await Deno.mkdir(scripts, { recursive: true });
  await Deno.mkdir(join(dir, ".specnaut", "backlog"));
  await Deno.mkdir(join(dir, ".specnaut", "scripts", "bash"));
  for (const f of ["common.sh", "template-resolution.sh", "_report_text.sh"]) {
    await Deno.copyFile(join(BASH, f), join(dir, ".specnaut", "scripts", "bash", f));
  }
  await Deno.mkdir(join(dir, "bin"));
  for await (const f of Deno.readDir(join(SCRIPTS, backend))) {
    await Deno.copyFile(join(SCRIPTS, backend, f.name), join(scripts, f.name));
  }
  // The shared bodies every backend receives beside its own scripts; the
  // audit collector installs elsewhere and is no backlog script.
  for await (const f of Deno.readDir(SCRIPTS)) {
    if (f.isFile && f.name !== "collect-audit-scope.sh") {
      await Deno.copyFile(join(SCRIPTS, f.name), join(scripts, f.name));
    }
  }
  const config = CONFIG[backend];
  if (config) await Deno.writeTextFile(join(dir, ".specnaut", "backlog-config.yml"), config);
  for (const [name, body] of Object.entries(FAKES)) {
    await Deno.writeTextFile(join(dir, "bin", name), `#!/usr/bin/env bash\n${body}\n`);
  }
  await Deno.writeTextFile(join(dir, "calls.log"), "");
  const read = (rel: string) => Deno.readTextFile(join(dir, rel));
  return {
    dir,
    async run(script, args, env) {
      const out = await new Deno.Command("bash", {
        args: [
          "-c",
          'export FAKE_ROOT="$PWD" HOME="$PWD" PATH="$PWD/bin:$PATH"; chmod +x bin/*; ' +
          ': > calls.log; s=$1; shift; exec bash ".specnaut/scripts/backlog/$s" "$@"',
          "driver",
          script,
          ...args,
        ],
        cwd: dir,
        env,
        stdout: "piped",
        stderr: "piped",
      }).output();
      const dec = new TextDecoder();
      return {
        code: out.code,
        stdout: dec.decode(out.stdout),
        stderr: dec.decode(out.stderr),
        calls: await read("calls.log"),
      };
    },
    read,
    write: (rel, text) => Deno.writeTextFile(join(dir, rel), text),
    cleanup: () => Deno.remove(dir, { recursive: true }),
  };
}

/** A local backlog item file, as `add.sh` writes it. */
export function localItem(num: string, title: string, body = "Body.\n"): string {
  return `---\nnumber: ${num}\ntitle: ${title}\nstatus: Ready\nsize:\npriority:\ncreated: 2026-01-01T00:00:00Z\n---\n\n${body}`;
}
